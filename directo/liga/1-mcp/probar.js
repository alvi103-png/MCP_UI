// Comprueba el servidor sin necesidad de un cliente de chat: node probar.js
// (el servidor tiene que estar arrancado con `npm run dev`)
// Solo llama a las herramientas que ya estén registradas, así que sirve después de cada paso.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const URL_SERVIDOR = process.env.MCP_URL ?? 'http://localhost:3003/mcp';
const MAX_LINEAS = 8;

const EJEMPLOS = {
  ver_clasificacion: {},
  ver_resultados: {},
  ver_equipo: { equipo: 'Barça' },
};

const client = new Client({ name: 'probar', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(URL_SERVIDOR)));

const { tools } = client.getServerCapabilities()?.tools ? await client.listTools() : { tools: [] };

if (tools.length === 0) {
  console.log('El servidor todavía no tiene herramientas: descomenta el paso 1 de server.js.');
  await client.close();
  process.exit();
}

console.log('Herramientas:');
for (const tool of tools) {
  const vista = tool._meta?.ui?.resourceUri;
  console.log(`  - ${tool.name}${vista ? `  → interfaz: ${vista}` : ''}`);
}

for (const { name } of tools) {
  const argumentos = EJEMPLOS[name] ?? {};
  const resultado = await client.callTool({ name, arguments: argumentos });
  const lineas = resultado.content[0].text.split('\n');

  console.log(`\n${name}(${JSON.stringify(argumentos)}):`);
  console.log(lineas.slice(0, MAX_LINEAS).join('\n'));
  if (lineas.length > MAX_LINEAS) console.log(`… (${lineas.length - MAX_LINEAS} líneas más)`);
  if (resultado.structuredContent) {
    console.log(`→ structuredContent para la vista: { ${Object.keys(resultado.structuredContent).join(', ')} }`);
  }
}

const conVista = tools.find((tool) => tool._meta?.ui?.resourceUri);
if (conVista) {
  const uri = conVista._meta.ui.resourceUri;
  try {
    const { contents } = await client.readResource({ uri });
    const [vista] = contents;
    console.log(`\nVista ${vista.uri}: ${vista.mimeType}, ${(vista.text.length / 1024).toFixed(0)} KB de HTML`);
  } catch {
    console.log(`\nLas herramientas enlazan ${uri}, pero el servidor todavía no sirve ese recurso (registerAppResource).`);
  }
} else {
  console.log('\nNinguna herramienta tiene interfaz: solo devuelven texto.');
}

await client.close();
