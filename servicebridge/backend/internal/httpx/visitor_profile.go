package httpx

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"customer-service/backend/internal/app"
	"customer-service/backend/internal/domain"
	"customer-service/backend/internal/store"
)

// ===== 访客画像（P5）HTTP 接口 =====
//
// 契约（控制台与 App 已按此实现）：
//
//	GET/PATCH /api/admin/visitor-profile/settings -> {"settings":{...}}
//	GET       /api/admin/visitor-profiles?q=&country=&tag=&limit=&offset= -> {"profiles":[...],"total":n}
//	GET       /api/admin/visitor-profiles/{visitor_id} -> {"profile":{...,"evidence":[],"conversations":[]}}
//	POST      /api/admin/visitor-profiles/{visitor_id}/refresh -> {"profile":{...}}
//	GET       /api/agent/conversations/{id}/profile -> {"profile":{...}}（越权 403、画像关闭/无画像 404）

// visitorProfileSettingsPatchRequest 是画像设置的局部更新请求。
// geoip_db_path 与 geoip_dir 是同一个字段：控制台用 geoip_db_path，历史/内部调用可能用 geoip_dir。
type visitorProfileSettingsPatchRequest struct {
	Enabled                *bool   `json:"enabled"`
	GeoIPDBPath            *string `json:"geoip_db_path"`
	GeoIPDir               *string `json:"geoip_dir"`
	ThirdPartyURL          *string `json:"third_party_url"`
	ThirdPartyKey          *string `json:"third_party_key"`
	ThirdPartyTimeoutMS    *int    `json:"third_party_timeout_ms"`
	CacheTTLHours          *int    `json:"cache_ttl_hours"`
	AISummaryEnabled       *bool   `json:"ai_summary_enabled"`
	AISummaryEveryMessages *int    `json:"ai_summary_every_messages"`
	ShowFullIP             *bool   `json:"show_full_ip"`
	// RetentionDays：0=永久保留；30/90/180 是控制台给的可选项，服务端接受 7..3650。
	RetentionDays *int `json:"retention_days"`
}

// registerVisitorProfileRoutes 注册画像相关的全部路由。
func registerVisitorProfileRoutes(mux *http.ServeMux, service *app.Service, trustedProxies trustedProxySet, geoIPUploadDir string) {
	mux.HandleFunc("GET /api/admin/visitor-profile/settings", func(w http.ResponseWriter, r *http.Request) {
		if !isAdmin(service, r) {
			writeError(w, store.ErrForbidden)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"settings": service.VisitorProfileSettings()})
	})

	mux.HandleFunc("PATCH /api/admin/visitor-profile/settings", func(w http.ResponseWriter, r *http.Request) {
		if !isAdmin(service, r) {
			writeError(w, store.ErrForbidden)
			return
		}
		var req visitorProfileSettingsPatchRequest
		if !decodeJSON(w, r, &req) {
			return
		}
		patch := domain.VisitorProfileSettingsPatch{
			Enabled:                req.Enabled,
			ThirdPartyURL:          req.ThirdPartyURL,
			ThirdPartyKey:          req.ThirdPartyKey,
			ThirdPartyTimeoutMS:    req.ThirdPartyTimeoutMS,
			CacheTTLHours:          req.CacheTTLHours,
			AISummaryEnabled:       req.AISummaryEnabled,
			AISummaryEveryMessages: req.AISummaryEveryMessages,
			ShowFullIP:             req.ShowFullIP,
			RetentionDays:          req.RetentionDays,
		}
		if req.RetentionDays != nil {
			if *req.RetentionDays != 0 && (*req.RetentionDays < domain.MinVisitorProfileRetentionDays || *req.RetentionDays > domain.MaxVisitorProfileRetentionDays) {
				writeError(w, fmt.Errorf("%w: retention_days 只能是 0（永久保留）或 %d-%d 天",
					store.ErrInvalidInput, domain.MinVisitorProfileRetentionDays, domain.MaxVisitorProfileRetentionDays))
				return
			}
		}
		// 两个键都接受；同时给出时以控制台契约键 geoip_db_path 为准。
		switch {
		case req.GeoIPDBPath != nil:
			patch.GeoIPDir = req.GeoIPDBPath
		case req.GeoIPDir != nil:
			patch.GeoIPDir = req.GeoIPDir
		}
		if req.ThirdPartyTimeoutMS != nil {
			if *req.ThirdPartyTimeoutMS < domain.MinThirdPartyTimeoutMS || *req.ThirdPartyTimeoutMS > domain.MaxThirdPartyTimeoutMS {
				writeError(w, fmt.Errorf("%w: third_party_timeout_ms 必须在 %d 与 %d 之间",
					store.ErrInvalidInput, domain.MinThirdPartyTimeoutMS, domain.MaxThirdPartyTimeoutMS))
				return
			}
		}
		if req.CacheTTLHours != nil {
			if *req.CacheTTLHours < 1 || *req.CacheTTLHours > domain.MaxCacheTTLHours {
				writeError(w, fmt.Errorf("%w: cache_ttl_hours 必须在 1 与 %d 之间",
					store.ErrInvalidInput, domain.MaxCacheTTLHours))
				return
			}
		}
		if req.AISummaryEveryMessages != nil {
			if *req.AISummaryEveryMessages < 1 || *req.AISummaryEveryMessages > domain.MaxAISummaryEveryMessages {
				writeError(w, fmt.Errorf("%w: ai_summary_every_messages 必须在 1 与 %d 之间",
					store.ErrInvalidInput, domain.MaxAISummaryEveryMessages))
				return
			}
		}
		updated, err := service.UpdateVisitorProfileSettings(patch)
		if err != nil {
			writeError(w, err)
			return
		}
		recordAuditFromRequest(service, r, trustedProxies, "visitor_profile_settings.update",
			"visitor_profile_settings", "1", "更新访客画像配置")
		writeJSON(w, http.StatusOK, map[string]any{"settings": updated})
	})

	mux.HandleFunc("POST /api/admin/visitor-profile/geoip-upload", func(w http.ResponseWriter, r *http.Request) {
		if !isAdmin(service, r) {
			writeError(w, store.ErrForbidden)
			return
		}
		const maxBytes = int64(128 << 20)
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes+4<<20)
		if err := r.ParseMultipartForm(8 << 20); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_upload", "message": "无法读取上传文件；GeoLite2 mmdb 最大 128 MB。"})
			return
		}
		if r.MultipartForm != nil {
			defer r.MultipartForm.RemoveAll()
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "file_required", "message": "请选择 GeoLite2-City.mmdb 文件。"})
			return
		}
		defer file.Close()
		if !strings.HasSuffix(strings.ToLower(strings.TrimSpace(header.Filename)), ".mmdb") {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_extension", "message": "只接受 .mmdb 文件（GeoLite2-City.mmdb）。"})
			return
		}
		dir := strings.TrimSpace(geoIPUploadDir)
		if dir == "" {
			dir = "geoip"
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "storage_unavailable", "message": "无法创建 GeoIP 存储目录。"})
			return
		}
		temp, err := os.CreateTemp(dir, ".geolite2-*.tmp")
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "storage_unavailable", "message": "无法写入 GeoIP 文件。"})
			return
		}
		tempName := temp.Name()
		cleanup := true
		defer func() {
			if cleanup {
				_ = os.Remove(tempName)
			}
		}()
		written, copyErr := io.Copy(temp, io.LimitReader(file, maxBytes+1))
		closeErr := temp.Close()
		if copyErr != nil || closeErr != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "upload_failed", "message": "GeoLite2 文件写入失败。"})
			return
		}
		if written > maxBytes {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "file_too_large", "message": "GeoLite2 mmdb 不能超过 128 MB。"})
			return
		}
		if written < 100*1024 {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "file_too_small", "message": "文件过小，看起来不是完整的 GeoLite2 mmdb。"})
			return
		}
		check, err := os.Open(tempName)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "upload_failed", "message": "无法校验 GeoLite2 文件。"})
			return
		}
		tail := make([]byte, 128*1024)
		if _, err := check.Seek(-int64(len(tail)), io.SeekEnd); err == nil {
			_, _ = io.ReadFull(check, tail)
		}
		_ = check.Close()
		if !bytes.Contains(tail, []byte("MaxMind.com")) {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_mmdb", "message": "文件不是有效的 MaxMind mmdb（缺少 MaxMind.com 标记）。"})
			return
		}
		target := filepath.Join(dir, "GeoLite2-City.mmdb")
		if err := os.Rename(tempName, target); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "upload_failed", "message": "无法保存 GeoLite2 文件。"})
			return
		}
		cleanup = false
		absolute, err := filepath.Abs(target)
		if err != nil {
			absolute = target
		}
		updated, err := service.UpdateVisitorProfileSettings(domain.VisitorProfileSettingsPatch{GeoIPDir: &absolute})
		if err != nil {
			writeError(w, err)
			return
		}
		recordAuditFromRequest(service, r, trustedProxies, "visitor_profile.geoip_upload",
			"visitor_profile_settings", "1", "上传 GeoLite2-City.mmdb 并启用本地地理库")
		writeJSON(w, http.StatusOK, map[string]any{
			"settings": updated,
			"path":     absolute,
			"bytes":    written,
		})
	})

	mux.HandleFunc("GET /api/admin/visitor-profiles", func(w http.ResponseWriter, r *http.Request) {
		if !isAdmin(service, r) {
			writeError(w, store.ErrForbidden)
			return
		}
		limit, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("limit")))
		offset, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("offset")))
		profiles, total, err := service.VisitorProfiles(domain.VisitorProfileQuery{
			Query:   r.URL.Query().Get("q"),
			Country: r.URL.Query().Get("country"),
			Tag:     r.URL.Query().Get("tag"),
			Limit:   limit,
			Offset:  offset,
		})
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"profiles": profiles, "total": total})
	})

	mux.HandleFunc("GET /api/admin/visitor-profiles/{visitor_id}", func(w http.ResponseWriter, r *http.Request) {
		if !isAdmin(service, r) {
			writeError(w, store.ErrForbidden)
			return
		}
		profile, err := service.VisitorProfileDetail(r.PathValue("visitor_id"))
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"profile": profile})
	})

	mux.HandleFunc("POST /api/admin/visitor-profiles/{visitor_id}/refresh", func(w http.ResponseWriter, r *http.Request) {
		if !isAdmin(service, r) {
			writeError(w, store.ErrForbidden)
			return
		}
		profile, err := service.RefreshVisitorProfile(r.Context(), r.PathValue("visitor_id"))
		if err != nil {
			writeError(w, err)
			return
		}
		recordAuditFromRequest(service, r, trustedProxies, "visitor_profile.refresh",
			"visitor_profile", r.PathValue("visitor_id"), "立即重算访客画像")
		writeJSON(w, http.StatusOK, map[string]any{"profile": profile})
	})

	// 客服会话侧画像卡：只允许客服/管理员访问（访客 token 也按越权处理），
	// 非本会话负责客服/围观客服 403；画像关闭或该访客无画像 404。
	mux.HandleFunc("GET /api/agent/conversations/{id}/profile", func(w http.ResponseWriter, r *http.Request) {
		conversationID := r.PathValue("id")
		session, err := service.AuthFromRequest(r)
		if err != nil || (session.Kind != domain.AccountAdmin && session.Kind != domain.AccountAgent) {
			writeError(w, store.ErrForbidden)
			return
		}
		if !canAccessConversation(service, r, conversationID) {
			writeError(w, store.ErrForbidden)
			return
		}
		profile, err := service.VisitorProfileForConversation(conversationID)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"profile": profile})
	})
}
