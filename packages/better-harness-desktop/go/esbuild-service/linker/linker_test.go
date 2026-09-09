package linker

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixture() Request {
	return Request{Version: 1, ID: 1, Method: "link", EntryModule: "/view.tsx",
		EntrySource: `export { default } from "/view.tsx";`, MaxOutputBytes: 1024 * 1024,
		Modules: []Module{{Path: "/view.tsx", Code: `import {value} from "./folder/value.js"; import React from "react"; export default {value, React};`},
			{Path: "/folder/value.ts", Code: `export const value = "你好😀";`}},
		RuntimePackages: []RuntimePackage{{"react", "https://runtime.test/react.js"}, {"@studio/agent-react", "runtime"}, {"@studio/agent-react/jsx-dev-runtime", "jsx"}},
	}
}

func TestLinkAndDiagnostics(t *testing.T) {
	for _, tc := range []struct{ name, code, status, diagnostic string }{
		{"valid", fixture().Modules[0].Code, "ready", ""},
		{"package", `import x from "not-approved"; export default x;`, "failed", "link/package-not-allowed"},
		{"builtin", `import x from "node:fs"; export default x;`, "failed", "link/package-not-allowed"},
		{"url", `import x from "https://example.test/x.js"; export default x;`, "failed", "link/package-not-allowed"},
		{"missing", `import x from "./missing.js"; export default x;`, "failed", "link/failed"},
		{"syntax", `const =`, "failed", "link/failed"},
		{"tsx refused", `export default <h1/>;`, "failed", "link/failed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := fixture()
			req.Modules[0].Code = tc.code
			result := Link(req)
			if result.Status != tc.status {
				t.Fatalf("%+v", result)
			}
			if tc.diagnostic != "" {
				if result.Bundle != "" || len(result.Diagnostics) == 0 || result.Diagnostics[0].Code != tc.diagnostic {
					t.Fatalf("%+v", result)
				}
			} else if result.Bundle == "" || len(result.Diagnostics) != 0 {
				t.Fatalf("%+v", result)
			}
		})
	}
}

func TestDoesNotReadHostFiles(t *testing.T) {
	file := filepath.Join(t.TempDir(), "secret.js")
	if err := os.WriteFile(file, []byte(`export default "host secret";`), 0600); err != nil {
		t.Fatal(err)
	}
	req := fixture()
	encoded, _ := json.Marshal(filepath.ToSlash(file))
	req.Modules[0].Code = "import value from " + string(encoded) + "; export default value;"
	result := Link(req)
	if result.Status != "failed" || result.Bundle != "" {
		t.Fatalf("host file escaped confinement: %+v", result)
	}
}

func TestResolutionOrder(t *testing.T) {
	modules := map[string]string{"/a/item.tsx": "", "/a/item.js": "", "/a/dir/index.ts": "", "/root.ts": ""}
	for _, tc := range []struct{ specifier, expected string }{{"./item.js", "/a/item.js"}, {"./item.mjs", "/a/item.tsx"}, {"./dir", "/a/dir/index.ts"}, {"../root.js", "/root.ts"}, {"./missing", ""}, {`C:\host\secret.js`, ""}, {`\\host\share\secret.js`, ""}} {
		if actual := resolveInternal(modules, "/a/view.tsx", tc.specifier); actual != tc.expected {
			t.Fatalf("%s: %s", tc.specifier, actual)
		}
	}
}

func TestAdmissionAndOutputLimits(t *testing.T) {
	for _, mutate := range []func(*Request){
		func(r *Request) { r.Version = 2 }, func(r *Request) { r.ID = 0 }, func(r *Request) { r.Method = "transform" },
		func(r *Request) { r.Modules[0].Path = "/a/../view.tsx" }, func(r *Request) { r.Modules[0].Path = `C:\view.tsx` },
		func(r *Request) { r.Modules = append(r.Modules, r.Modules[0]) }, func(r *Request) { r.EntryModule = "/missing.tsx" },
		func(r *Request) { r.Modules[0].Code = strings.Repeat("x", MaxModule+1) },
		func(r *Request) { r.MaxOutputBytes = 0 }, func(r *Request) { r.MaxOutputBytes = MaxOutput + 1 },
		func(r *Request) { r.RuntimePackages = nil }, func(r *Request) { r.RuntimePackages = append(r.RuntimePackages, r.RuntimePackages[0]) },
	} {
		req := fixture()
		mutate(&req)
		if result := Link(req); result.Status != "failed" || result.Bundle != "" {
			t.Fatalf("%+v", result)
		}
	}
	req := fixture()
	req.MaxOutputBytes = 1
	if result := Link(req); result.Diagnostics[0].Code != "limit/output-bytes" || result.Bundle != "" {
		t.Fatalf("%+v", result)
	}
}

func TestWireProtocol(t *testing.T) {
	req := fixture()
	frame, _ := json.Marshal(req)
	var response Response
	if err := json.Unmarshal(Handle(frame), &response); err != nil {
		t.Fatal(err)
	}
	if response.ID != 1 || response.PID != os.Getpid() || response.EngineVersion != Version || response.Result.Status != "ready" {
		t.Fatalf("%+v", response)
	}
	for _, bad := range [][]byte{[]byte("{"), append(append([]byte{}, frame...), frame...), []byte(`{"version":1,"unexpected":true}`)} {
		if err := json.Unmarshal(Handle(bad), &response); err != nil || response.Result.Status != "failed" {
			t.Fatalf("%+v %v", response, err)
		}
	}
	var output bytes.Buffer
	if err := Serve(bytes.NewReader(frame), &output); err == nil || output.Len() != 0 {
		t.Fatal("accepted truncated frame")
	}
	input := append(append(append([]byte{}, frame...), '\n'), append(frame, '\n')...)
	if err := Serve(bytes.NewReader(input), &output); err != nil || bytes.Count(output.Bytes(), []byte{'\n'}) != 2 {
		t.Fatalf("%v", err)
	}
}
