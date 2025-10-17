package main

import (
	"encoding/json"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// ---------- API I/O ----------
type Req struct {
	Text string `json:"text"`
}
type Item struct {
	Code  string  `json:"code"`
	Value float64 `json:"value"`
	Grade string  `json:"grade"`
}
type Res struct {
	Items []Item `json:"items"`
}

// ---------- 簡易パーサ & 判定（最小動作用） ----------
var rowRe = regexp.MustCompile(`^\s*\d+\s+([A-Za-z]+)\.?\s+([\d.]+)`)

func gradeHb(v float64) string {
	switch {
	case v < 8:
		return "G3-4"
	case v < 10:
		return "G2"
	case v < 11:
		return "G1"
	default:
		return "G0"
	}
}

func parse(text string) []Item {
	var out []Item
	lines := strings.Split(text, "\n")
	for _, ln := range lines {
		m := rowRe.FindStringSubmatch(strings.TrimSpace(ln))
		if len(m) != 3 {
			continue
		}
		val, _ := strconv.ParseFloat(m[2], 64)
		code := strings.ToUpper(m[1])
		it := Item{Code: code, Value: val}

		// 最小デモ：Hbのみ判定（必要に応じて拡張）
		if code == "HB" {
			it.Grade = gradeHb(val)
		} else {
			it.Grade = ""
		}
		out = append(out, it)
	}
	return out
}

// ---------- ハンドラ ----------
func handleEvaluate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	var q Req
	if err := json.NewDecoder(r.Body).Decode(&q); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	resp := Res{Items: parse(q.Text)}
	_ = json.NewEncoder(w).Encode(resp)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true,"name":"ctcae-local-api","version":"1.0"}`))
}

// ---------- ブラウザ起動 ----------
func openBrowser(url string) {
	if runtime.GOOS == "windows" {
		_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
		return
	}
	_ = exec.Command("xdg-open", url).Start()
}

func main() {
	// 実行ファイルパス → ui ディレクトリ解決（…\bin\..\ui）
	exePath, _ := os.Executable()
	binDir := filepath.Dir(exePath)
	uiDir := filepath.Join(filepath.Dir(binDir), "ui")

	// ルーティング
	mux := http.NewServeMux()
	mux.HandleFunc("/api/evaluate", handleEvaluate)
	mux.HandleFunc("/health", handleHealth)
	mux.Handle("/", http.FileServer(http.Dir(uiDir))) // "/" → index.html を配信

	// ポート（環境変数で変更可。未設定なら 18080）
	port := os.Getenv("CTCAE_PORT")
	if port == "" {
		port = "18080"
	}

	ln, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		log.Fatal(err)
	}
	// 自動でブラウザを開く（失敗しても致命的ではない）
	go func() {
		time.Sleep(300 * time.Millisecond)
		openBrowser("http://127.0.0.1:" + port + "/")
	}()
	log.Printf("listening on http://127.0.0.1:%s", port)
	log.Fatal(http.Serve(ln, mux))
}
