#!/bin/sh
cd browsertests/editor/ && python -m SimpleHTTPServer &
httpserver=$!
sleep 1

TARGET=http://localhost:8000 npx mocha -r ts-node/register/transpile-only -t 8000 browsertests/cases/test-*.ts $@

kill $httpserver
