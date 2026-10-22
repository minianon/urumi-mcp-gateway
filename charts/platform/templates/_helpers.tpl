{{- define "platform.labels" -}}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: urumi
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}

{{/* app.kubernetes.io/name is what other charts' NetworkPolicies select on (e.g. "gateway"). */}}
{{- define "platform.selector" -}}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/name: {{ .name }}
{{- end }}

{{- define "platform.secretName" -}}
{{- .Values.secrets.existingSecret | default (printf "%s-credentials" .Release.Name) -}}
{{- end }}

{{- define "platform.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: ["ALL"]
{{- end }}

{{- define "platform.podSecurity" -}}
runAsNonRoot: true
runAsUser: {{ .uid }}
runAsGroup: {{ .uid }}
fsGroup: {{ .uid }}
seccompProfile:
  type: RuntimeDefault
{{- end }}

{{- define "platform.tokenEnv" -}}
UPSTREAM_TOKEN_{{ . | upper | replace "-" "_" }}
{{- end }}
