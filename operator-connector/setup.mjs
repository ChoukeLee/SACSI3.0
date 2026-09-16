import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, readFileSync } from 'node:fs';
import { validateConfig } from './core.mjs';
export function mcpConfig(directory,local=false) {
  const quote=value=>JSON.stringify(value.replaceAll('\\','/'));
  return `[mcp_servers.${local?'sacsi_operator_local':'sacsi_operator'}]\ncommand = ${quote(join(directory,'node.exe'))}\nargs = [${quote(join(directory,'mcp-server.mjs'))}]\nstartup_timeout_sec = 15\ntool_timeout_sec = 180\nenabled = true\n`;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const directory=dirname(fileURLToPath(import.meta.url));
  try {
    const config=validateConfig(JSON.parse(readFileSync(join(directory,'config.json'),'utf8')));
    const text=mcpConfig(directory,config.localTest===true);
    // Only generates a snippet beside the package; never replaces user configuration.
    writeFileSync(join(directory,'codex-mcp-config.txt'),text);
    console.log('SACSI MCP config generated: codex-mcp-config.txt\nCopy this section into Codex Settings > Configuration > config.toml, then restart Codex.\nKeep this package in its current folder. No passwords or tokens are included.');
    console.log(text);
  } catch {console.error('SACSI setup failed. Check package files.');process.exitCode=1;}
}
