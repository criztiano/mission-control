import { spawn } from 'node:child_process'
import { config } from './config'

interface CommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  input?: string
}

interface CommandResult {
  stdout: string
  stderr: string
  code: number | null
}

export function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false
    })

    let stdout = ''
    let stderr = ''
    let timeoutId: NodeJS.Timeout | undefined

    if (options.timeoutMs) {
      timeoutId = setTimeout(() => {
        child.kill('SIGKILL')
      }, options.timeoutMs)
    }

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId)
      reject(error)
    })

    child.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId)
      if (code === 0) {
        resolve({ stdout, stderr, code })
        return
      }
      const error = new Error(
        `Command failed (${command} ${args.join(' ')}): ${stderr || stdout}`
      )
      ;(error as any).stdout = stdout
      ;(error as any).stderr = stderr
      ;(error as any).code = code
      reject(error)
    })

    if (options.input) {
      child.stdin.write(options.input)
      child.stdin.end()
    }
  })
}

export function runOpenClaw(args: string[], options: CommandOptions = {}) {
  return runCommand(config.openclawBin, args, {
    ...options,
    cwd: options.cwd || config.openclawHome || process.cwd()
  })
}

/**
 * Fire-and-forget: spawn an OpenClaw command without waiting for it to finish.
 * Returns immediately after the process starts. Used for agent dispatches that
 * may take minutes (spawn-based agents like Dumbo).
 */
export function runOpenClawDetached(args: string[], options: Omit<CommandOptions, 'timeoutMs'> = {}) {
  const child = spawn(config.openclawBin, args, {
    cwd: options.cwd || config.openclawHome || process.cwd(),
    env: options.env,
    shell: false,
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  return child.pid
}

export function runClawdbot(args: string[], options: CommandOptions = {}) {
  return runCommand(config.clawdbotBin, args, {
    ...options,
    cwd: options.cwd || config.openclawHome || process.cwd()
  })
}
