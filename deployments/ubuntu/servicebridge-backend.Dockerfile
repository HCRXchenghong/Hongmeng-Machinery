FROM golang:1.25-alpine AS build
# 国内 VPS 直连 proxy.golang.org / dl-cdn 会超时；部署脚本按线路传入这两个参数。
ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=${GOPROXY}
ARG APK_MIRROR=""

WORKDIR /src
RUN if [ -n "$APK_MIRROR" ]; then sed -i "s|https\?://dl-cdn.alpinelinux.org|$APK_MIRROR|g" /etc/apk/repositories; fi && \
    apk add --no-cache ca-certificates tzdata
COPY servicebridge/backend/go.mod servicebridge/backend/go.sum ./
RUN go mod download
COPY servicebridge/backend ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/customer-service ./cmd/server

FROM alpine:3.22
# 国内 VPS 直连 dl-cdn.alpinelinux.org 可能超时；部署脚本会按线路传入 APK_MIRROR。
ARG APK_MIRROR=""
RUN if [ -n "$APK_MIRROR" ]; then sed -i "s|https\?://dl-cdn.alpinelinux.org|$APK_MIRROR|g" /etc/apk/repositories; fi && \
    apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=build /out/customer-service /app/customer-service
EXPOSE 8080
CMD ["/app/customer-service"]
