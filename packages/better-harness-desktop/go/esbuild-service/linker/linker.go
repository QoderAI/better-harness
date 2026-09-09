// Package linker links admitted ESM over an explicitly supplied virtual revision.
// It never resolves an import through the host filesystem or network.
package linker

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
	"sync/atomic"
	"unicode/utf8"

	"github.com/evanw/esbuild/pkg/api"
)

const Version = "esbuild-go-0.28.2+link-v1"
const MaxFrame = 64 * 1024 * 1024
const MaxModule = 1024 * 1024
const MaxTotal = 32 * 1024 * 1024
const MaxOutput = 16 * 1024 * 1024

type Module struct {
	Path string `json:"path"`
	Code string `json:"code"`
}
type RuntimePackage struct {
	Specifier string `json:"specifier"`
	External  string `json:"external"`
}
type Request struct {
	Version         int              `json:"version"`
	ID              uint32           `json:"id"`
	Method          string           `json:"method"`
	EntryModule     string           `json:"entryModule"`
	EntrySource     string           `json:"entrySource"`
	Modules         []Module         `json:"modules"`
	RuntimePackages []RuntimePackage `json:"runtimePackages"`
	MaxOutputBytes  int              `json:"maxOutputBytes"`
}
type Diagnostic struct {
	Level   string `json:"level"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Module  string `json:"module,omitempty"`
	Line    int    `json:"line,omitempty"`
	Column  *int   `json:"column,omitempty"`
}
type Result struct {
	Status      string       `json:"status"`
	Bundle      string       `json:"bundle,omitempty"`
	Diagnostics []Diagnostic `json:"diagnostics"`
}
type Response struct {
	Version       int    `json:"version"`
	ID            uint32 `json:"id"`
	PID           int    `json:"pid"`
	EngineVersion string `json:"engineVersion"`
	Result        Result `json:"result"`
}

func failed(code, message string) Result {
	return Result{Status: "failed", Diagnostics: []Diagnostic{{Level: "error", Code: code, Message: message}}}
}

func validPath(value string) bool {
	return strings.HasPrefix(value, "/") && value != "/" && path.Clean(value) == value &&
		len(value) <= 4096 && !strings.ContainsAny(value, "\\\x00") && utf8.ValidString(value)
}

func validate(req Request) error {
	if req.Version != 1 || req.ID == 0 || req.Method != "link" {
		return fmt.Errorf("unsupported linker envelope")
	}
	if !validPath(req.EntryModule) || len(req.EntrySource) == 0 || len(req.EntrySource) > MaxModule {
		return fmt.Errorf("invalid linker entry")
	}
	if len(req.Modules) == 0 || len(req.Modules) > 512 || req.MaxOutputBytes <= 0 || req.MaxOutputBytes > MaxOutput {
		return fmt.Errorf("linker module or output limit exceeded")
	}
	seen := map[string]bool{}
	total := len(req.EntrySource)
	for _, module := range req.Modules {
		if !validPath(module.Path) || seen[module.Path] || len(module.Code) > MaxModule || !utf8.ValidString(module.Code) {
			return fmt.Errorf("invalid, duplicate, or oversized linker module")
		}
		seen[module.Path] = true
		total += len(module.Code)
		if total > MaxTotal {
			return fmt.Errorf("linker source limit exceeded")
		}
	}
	if !seen[req.EntryModule] {
		return fmt.Errorf("entry is outside the submitted revision")
	}
	if len(req.RuntimePackages) > 512 {
		return fmt.Errorf("runtime package limit exceeded")
	}
	packages := map[string]bool{}
	for _, pkg := range req.RuntimePackages {
		if pkg.Specifier == "" || pkg.External == "" || len(pkg.Specifier) > 4096 || len(pkg.External) > 4096 ||
			strings.ContainsAny(pkg.Specifier+pkg.External, "\x00\r\n") || packages[pkg.Specifier] {
			return fmt.Errorf("invalid runtime package mapping")
		}
		packages[pkg.Specifier] = true
	}
	for _, required := range []string{"react", "@studio/agent-react", "@studio/agent-react/jsx-dev-runtime"} {
		if !packages[required] {
			return fmt.Errorf("missing trusted runtime package")
		}
	}
	return nil
}

// Resolution ordering matches Studio's allowed-packages resolver, including
// .js imports of TypeScript sources. path (not filepath) owns wire identifiers.
func resolveInternal(modules map[string]string, importer, specifier string) string {
	base := specifier
	if !strings.HasPrefix(base, "/") {
		base = path.Join(path.Dir(importer), base)
	}
	roots := []string{base}
	if strings.HasSuffix(base, ".js") {
		roots = append(roots, strings.TrimSuffix(base, ".js"))
	}
	if strings.HasSuffix(base, ".mjs") {
		roots = append(roots, strings.TrimSuffix(base, ".mjs"))
	}
	candidates := append([]string{}, roots...)
	for _, root := range roots {
		for _, ext := range []string{".tsx", ".ts", ".jsx", ".js", ".mjs"} {
			candidates = append(candidates, root+ext)
		}
	}
	for _, root := range roots {
		for _, ext := range []string{".tsx", ".ts", ".jsx", ".js", ".mjs"} {
			candidates = append(candidates, root+"/index"+ext)
		}
	}
	for _, candidate := range candidates {
		if _, ok := modules[candidate]; ok {
			return candidate
		}
	}
	return ""
}

func Link(req Request) Result {
	if err := validate(req); err != nil {
		return failed("link/failed", err.Error())
	}
	modules := map[string]string{}
	for _, module := range req.Modules {
		modules[module.Path] = module.Code
	}
	packages := map[string]string{}
	for _, pkg := range req.RuntimePackages {
		packages[pkg.Specifier] = pkg.External
	}
	var rejectedPackage atomic.Bool
	plugin := api.Plugin{Name: "agent-react-linker", Setup: func(build api.PluginBuild) {
		build.OnResolve(api.OnResolveOptions{Filter: ".*"}, func(args api.OnResolveArgs) (api.OnResolveResult, error) {
			if args.Kind == api.ResolveEntryPoint {
				return api.OnResolveResult{Path: "agent-react:bundle-entry", Namespace: "agent-react-entry"}, nil
			}
			if external, ok := packages[args.Path]; ok {
				return api.OnResolveResult{Path: external, External: true}, nil
			}
			if !strings.HasPrefix(args.Path, ".") && !strings.HasPrefix(args.Path, "/") {
				rejectedPackage.Store(true)
				return api.OnResolveResult{Errors: []api.Message{{Text: fmt.Sprintf("Package import '%s' is not provided by the AgentReact Trusted Bootstrap.", args.Path)}}}, nil
			}
			importer := args.Importer
			if args.Namespace == "agent-react-entry" {
				importer = req.EntryModule
			}
			resolved := resolveInternal(modules, importer, args.Path)
			if resolved == "" {
				return api.OnResolveResult{Errors: []api.Message{{Text: fmt.Sprintf("Artifact import '%s' is not part of this Artifact Revision.", args.Path)}}}, nil
			}
			return api.OnResolveResult{Path: resolved, Namespace: "agent-react"}, nil
		})
		build.OnLoad(api.OnLoadOptions{Filter: ".*", Namespace: "agent-react-entry"}, func(args api.OnLoadArgs) (api.OnLoadResult, error) {
			return api.OnLoadResult{Contents: &req.EntrySource, Loader: api.LoaderJS}, nil
		})
		build.OnLoad(api.OnLoadOptions{Filter: ".*", Namespace: "agent-react"}, func(args api.OnLoadArgs) (api.OnLoadResult, error) {
			contents, ok := modules[args.Path]
			if !ok {
				return api.OnLoadResult{Errors: []api.Message{{Text: "module has no compiled output"}}}, nil
			}
			return api.OnLoadResult{Contents: &contents, Loader: api.LoaderJS}, nil
		})
	}}
	build := api.Build(api.BuildOptions{
		EntryPoints: []string{"agent-react:bundle-entry"}, Bundle: true, Write: false,
		Format: api.FormatESModule, Platform: api.PlatformBrowser, Target: api.ES2022,
		LegalComments: api.LegalCommentsNone, LogLevel: api.LogLevelSilent,
		Outfile: "artifact-bundle.js", Plugins: []api.Plugin{plugin},
	})
	diagnostics := []Diagnostic{}
	for _, group := range []struct {
		level    string
		messages []api.Message
	}{{"error", build.Errors}, {"warning", build.Warnings}} {
		for _, message := range group.messages {
			code := "link/failed"
			if rejectedPackage.Load() {
				code = "link/package-not-allowed"
			}
			diagnostic := Diagnostic{Level: group.level, Code: code, Message: message.Text}
			if message.Location != nil {
				diagnostic.Module = message.Location.File
				diagnostic.Line = message.Location.Line
				diagnostic.Column = &message.Location.Column
			}
			diagnostics = append(diagnostics, diagnostic)
		}
	}
	if len(build.Errors) > 0 {
		return Result{Status: "failed", Diagnostics: diagnostics}
	}
	for _, output := range build.OutputFiles {
		if strings.HasSuffix(output.Path, ".js") {
			if len(output.Contents) > req.MaxOutputBytes {
				return failed("limit/output-bytes", "Linked bundle exceeds its output limit.")
			}
			return Result{Status: "ready", Bundle: string(output.Contents), Diagnostics: diagnostics}
		}
	}
	return failed("link/failed", "Linker produced no JavaScript output.")
}

func Handle(frame []byte) []byte {
	response := Response{Version: 1, PID: os.Getpid(), EngineVersion: Version}
	var req Request
	decoder := json.NewDecoder(bytes.NewReader(frame))
	decoder.DisallowUnknownFields()
	if len(frame) > MaxFrame || !utf8.Valid(frame) || decoder.Decode(&req) != nil {
		response.Result = failed("link/failed", "Invalid linker request.")
	} else {
		response.ID = req.ID
		var extra any
		if decoder.Decode(&extra) != io.EOF {
			response.Result = failed("link/failed", "Trailing linker request data.")
		} else {
			response.Result = Link(req)
		}
	}
	encoded, _ := json.Marshal(response)
	if len(encoded) > MaxFrame {
		response.Result = failed("limit/output-bytes", "Linker response exceeds its frame limit.")
		encoded, _ = json.Marshal(response)
	}
	return encoded
}

func Serve(input io.Reader, output io.Writer) error {
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 64*1024), MaxFrame+1)
	scanner.Split(func(data []byte, atEOF bool) (int, []byte, error) {
		if end := bytes.IndexByte(data, '\n'); end >= 0 {
			return end + 1, data[:end], nil
		}
		if atEOF && len(data) > 0 {
			return 0, nil, io.ErrUnexpectedEOF
		}
		return 0, nil, nil
	})
	for scanner.Scan() {
		if _, err := fmt.Fprintf(output, "%s\n", Handle(scanner.Bytes())); err != nil {
			return err
		}
	}
	return scanner.Err()
}
