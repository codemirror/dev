# CodeMirror

[![Build Status](https://github.com/codemirror/dev/workflows/main/badge.svg)](https://github.com/codemirror/codemirror.next/actions)

This is the central repository for [CodeMirror](https://codemirror.net/). It holds the bug tracker and development scripts.

If you want to **use** CodeMirror, install the separate packages from npm, and ignore the contents of this repository. If you want to **develop on** CodeMirror, this repository provides scripts to install and work with the various packages.

To get started, make sure you are running [node.js](https://nodejs.org/) version 16. After cloning the repository, run

    node bin/cm.js install

to clone the packages that make up the system, install dependencies, and build the packages. At any time you can rebuild packages, either by running `npm run prepare` in their subdirectory, or all at once with

    node bin/cm.js build

Developing is best done by setting up

    npm run dev

which starts a server that automatically rebuilds the packages when their code changes and exposes a dev server on port 8090 running the [demo](http://localhost:8090) and [browser tests](http://localhost:8090/test/).

Please see [the website](https://codemirror.net/) for more information and [docs](https://codemirror.net/docs/ref).
