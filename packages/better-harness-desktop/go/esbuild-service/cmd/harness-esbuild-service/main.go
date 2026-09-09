package main

import (
	"github.com/QoderAI/better-harness/esbuild-service/linker"
	"os"
)

func main() {
	if linker.Serve(os.Stdin, os.Stdout) != nil {
		os.Exit(1)
	}
}
