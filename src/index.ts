import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";

// Initialize a lightweight MCP Server
const server = new Server({ name: "sf-field-doc-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });

// Register the tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "generate_proposal",
      description: "Reads a single Salesforce .field-meta.xml file and shows a draft description and help text for review.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Absolute path to the field xml file" },
          businessPurpose: { type: "string", description: "Why this field exists / what it handles" }
        },
        required: ["filePath", "businessPurpose"]
      }
    },
    {
      name: "save_metadata_changes",
      description: "Saves updates directly to the file based on the user's choices.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          description: { type: "string" },
          inlineHelpText: { type: "string" },
          updateDescription: { type: "boolean" },
          updateHelpText: { type: "boolean" }
        },
        required: ["filePath", "description", "inlineHelpText", "updateDescription", "updateHelpText"]
      }
    }
  ]
}));

// Helper to inject or update an XML tag cleanly using Regular Expressions
function upsertTag(xml: string, tag: string, value: string): string {
  const cleanValue = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const pattern = new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g");
  return pattern.test(xml) 
    ? xml.replace(pattern, `<${tag}>${cleanValue}</${tag}>`)
    : xml.replace("</CustomField>", `    <${tag}>${cleanValue}</${tag}>\n</CustomField>`);
}

// Handle Tool Executions
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "generate_proposal") {
      const { filePath, businessPurpose } = args as { filePath: string; businessPurpose: string };
      if (!fs.existsSync(filePath)) return { isError: true, content: [{ type: "text", text: `File not found.` }] };

      const xml = fs.readFileSync(filePath, "utf-8");
      
      // Clean parsing strategy avoiding syntax token chaining breaks
      const labelMatch = xml.match(/<label>([\s\(\S\)]*?)<\/label>/);
      const label = labelMatch && labelMatch[1] ? labelMatch[1].trim() : "this field";

      const typeMatch = xml.match(/<type>([\s\(\S\)]*?)<\/type>/);
      const type = typeMatch && typeMatch[1] ? typeMatch[1].trim() : "Field";

      // Algorithmic processing matching Salesforce structural bounds
      const proposedDesc = `Type: ${type}. Purpose: ${businessPurpose}`.substring(0, 990);
      const proposedHelp = `Enter the applicable data for ${label} (${type}).`.substring(0, 245);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ label, type, proposedDesc, proposedHelp, filePath }, null, 2)
        }]
      };
    }

    if (name === "save_metadata_changes") {
      const input = args as { filePath: string; description: string; inlineHelpText: string; updateDescription: boolean; updateHelpText: boolean };
      let xml = fs.readFileSync(input.filePath, "utf-8");

      if (input.updateDescription) xml = upsertTag(xml, "description", input.description);
      if (input.updateHelpText) xml = upsertTag(xml, "inlineHelpText", input.inlineHelpText);

      fs.writeFileSync(input.filePath, xml, "utf-8");
      return { content: [{ type: "text", text: "Successfully saved choices directly to the local XML file!" }] };
    }

    throw new Error("Tool not found");
  } catch (err: any) {
    return { isError: true, content: [{ type: "text", text: `Error: ${err.message}` }] };
  }
});

// Bootstrapping function wrapped cleanly to handle CommonJS constraints
async function bootstrap() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Simple Step Documenter running.");
}

bootstrap().catch(err => console.error("Start error:", err));
