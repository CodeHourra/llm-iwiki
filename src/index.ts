#!/usr/bin/env bun
import { runCli } from './cli'

const exitCode = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: console.log,
  stderr: console.error,
})

process.exit(exitCode)
