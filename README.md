# CodeMirror 6 prototype

[![Build Status](https://github.com/codemirror/codemirror.next/workflows/main/badge.svg)](https://github.com/codemirror/codemirror.next/actions)
[![NPM version](https://img.shields.io/npm/v/@codemirror/next.svg)](https://www.npmjs.org/package/@codemirror/next)

This is the prototype of the next version of [CodeMirror](https://codemirror.net), a complete rewrite.

Eventually, the content of this repository will move into different packages. For now, to reduce friction during development, it is a monorepo. Its content is published as the `@codemirror/next` package on [npm](https://npmjs.com).

To get started, make sure you are running [node.js](https://nodejs.org/) version 13. After cloning the repository, run

    npm install

to install dependencies, and

    npm run dev

to start a server that automatically rebuilds the bundles when the code changes and exposes a dev server on port 8090 running the [demo](http://localhost:8090) and [tests](http://localhost:8090/test).

Please see [the website](https://codemirror.net/6/) for more information and [docs](https://codemirror.net/6/docs/ref).

This code is dual-licensed under the MIT and GPL-v3 licenses. This means that you, as user, may choose one of these licenses to abide by. I.e. if complying with the GPL is problematic for you, you can choose the more liberal MIT license.
