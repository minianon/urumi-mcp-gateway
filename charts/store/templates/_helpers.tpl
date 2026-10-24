{{- define "store.labels" -}}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: urumi
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}

{{- define "store.selector" -}}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "store.secretName" -}}
{{- .Values.secrets.existingSecret | default (printf "%s-credentials" .Release.Name) -}}
{{- end }}

{{- define "store.storageClass" -}}
{{- if .Values.persistence.storageClass }}
storageClassName: {{ .Values.persistence.storageClass | quote }}
{{- end }}
{{- end }}

{{/* Restricted Pod Security Standard: non-root, no privilege escalation, no capabilities. */}}
{{- define "store.containerSecurity" -}}
allowPrivilegeEscalation: false
capabilities:
  drop: ["ALL"]
{{- end }}

{{- define "store.podSecurity" -}}
runAsNonRoot: true
runAsUser: {{ .uid }}
runAsGroup: {{ .uid }}
fsGroup: {{ .uid }}
seccompProfile:
  type: RuntimeDefault
{{- end }}

{{/* DB + URL env shared by WordPress and the setup Job (wp-config.php reads them at runtime). */}}
{{- define "store.wpEnv" -}}
- name: WORDPRESS_DB_HOST
  value: {{ .Release.Name }}-mariadb:3306
- name: WORDPRESS_DB_NAME
  value: wordpress
- name: WORDPRESS_DB_USER
  value: wordpress
- name: WORDPRESS_DB_PASSWORD
  valueFrom:
    secretKeyRef: { name: {{ include "store.secretName" . }}, key: db-password }
- name: WP_PUBLIC_URL
  value: {{ .Values.store.publicUrl | quote }}
- name: WP_ENVIRONMENT_TYPE
  value: {{ .Values.wordpress.environmentType | quote }}
- name: WORDPRESS_CONFIG_EXTRA
  value: |
    define('WP_HOME', getenv('WP_PUBLIC_URL'));
    define('WP_SITEURL', getenv('WP_PUBLIC_URL'));
    define('WP_ENVIRONMENT_TYPE', getenv('WP_ENVIRONMENT_TYPE') ?: 'production');
    // TLS terminates at the Ingress controller.
    if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') { $_SERVER['HTTPS'] = 'on'; }
    // Code and plugin versions are managed by Helm, not by clicking "update" in wp-admin.
    define('AUTOMATIC_UPDATER_DISABLED', true);
    define('DISALLOW_FILE_EDIT', true);
{{- end }}

{{/*
Apache vhost. ServerName carries the public scheme and port so Apache's own redirects (e.g.
/wp-admin -> /wp-admin/) point at the Ingress, not at the container's port 8080. The hostname
still comes from the request (UseCanonicalName Off), so in-cluster callers keep their Host.
*/}}
{{- define "store.apacheSite" -}}
{{- $u := urlParse .Values.store.publicUrl -}}
{{- $hostport := $u.host -}}
{{- if not (contains ":" $u.host) -}}
{{- $hostport = printf "%s:%s" $u.host (ternary "443" "80" (eq $u.scheme "https")) -}}
{{- end -}}
<VirtualHost *:8080>
  ServerName {{ $u.scheme }}://{{ $hostport }}
  UseCanonicalName Off
  ServerAdmin webmaster@localhost
  DocumentRoot /var/www/html
  ErrorLog ${APACHE_LOG_DIR}/error.log
  # Keep kubelet probes out of the access log.
  SetEnvIf User-Agent "^kube-probe" dontlog
  CustomLog ${APACHE_LOG_DIR}/access.log combined env=!dontlog
</VirtualHost>
{{- end }}
