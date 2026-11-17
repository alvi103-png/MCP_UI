// Comprueba el servidor sin necesidad de un cliente de chat: node probar.js
// (el servidor tiene que estar arrancado con `npm run dev`)
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const URL_SERVIDOR = process.env.MCP_URL ?? 'http://localhost:3001/mcp';

const client = new Client({ name: 'probar', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(URL_SERVIDOR)));

const { tools } = await client.listTools();
console.log('Herramientas:');
for (const tool of tools) {
  const vista = tool._meta?.ui?.resourceUri;
  console.log(`  - ${tool.name}${vista ? `  → interfaz: ${vista}` : ''}`);
}

const busqueda = await client.callTool({ name: 'buscar_productos', arguments: { categoria: 'audio' } });
console.log('\nbuscar_productos({ categoria: "audio" }):');
console.log(busqueda.content[0].text);

const conVista = tools.find((tool) => tool._meta?.ui?.resourceUri);
if (conVista) {
  const { contents } = await client.readResource({ uri: conVista._meta.ui.resourceUri });
  const [vista] = contents;
  console.log(`\nVista ${vista.uri}: ${vista.mimeType}, ${(vista.text.length / 1024).toFixed(0)} KB de HTML`);
} else {
  console.log('\n⚠️  Ninguna herramienta tiene interfaz todavía (_meta.ui.resourceUri).');
}

await client.close();
