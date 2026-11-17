// Comprueba el servidor sin necesidad de un cliente de chat: node probar.js
// (el servidor tiene que estar arrancado con `npm run dev`)
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const URL_SERVIDOR = process.env.MCP_URL ?? 'http://localhost:3003/mcp';

const client = new Client({ name: 'probar', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(URL_SERVIDOR)));

const { tools } = await client.listTools();
console.log('Herramientas:');
for (const tool of tools) {
  const vista = tool._meta?.ui?.resourceUri;
  console.log(`  - ${tool.name}${vista ? `  → interfaz: ${vista}` : ''}`);
}

const llamadas = [
  { name: 'ver_resultados', arguments: {} },
  { name: 'ver_equipo', arguments: { equipo: 'Barça' } },
];

for (const llamada of llamadas) {
  const resultado = await client.callTool(llamada);
  console.log(`\n${llamada.name}(${JSON.stringify(llamada.arguments)}):`);
  console.log(resultado.content[0].text);
}

const conVista = tools.find((tool) => tool._meta?.ui?.resourceUri);
if (conVista) {
  const { contents } = await client.readResource({ uri: conVista._meta.ui.resourceUri });
  const [vista] = contents;
  console.log(`\nVista ${vista.uri}: ${vista.mimeType}, ${(vista.text.length / 1024).toFixed(0)} KB de HTML`);
} else {
  console.log('\nNinguna herramienta tiene interfaz: solo devuelven texto.');
}

await client.close();
