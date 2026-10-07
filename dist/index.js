"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const ollama_1 = __importDefault(require("ollama")); // Native official package compiles perfectly 
const fs = __importStar(require("fs"));
// Initialize the MCP Server
const server = new index_js_1.Server({ name: "sf-field-doc-mcp", version: "2.0.0" }, { capabilities: { tools: {} } });
// Register the tool definitions
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "generate_proposal",
            description: "Uses a completely local NLP model to read a Salesforce field and draft an intelligent description and help text for review.",
            inputSchema: {
                type: "object",
                properties: {
                    filePath: { type: "string", description: "Absolute path to the field xml file" },
                    businessPurpose: { type: "string", description: "The core business purpose or loose requirement notes" }
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
function upsertTag(xml, tag, value) {
    const cleanValue = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const pattern = new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g");
    return pattern.test(xml)
        ? xml.replace(pattern, `<${tag}>${cleanValue}</${tag}>`)
        : xml.replace("</CustomField>", `    <${tag}>${cleanValue}</${tag}>\n</CustomField>`);
}
// Handle Tool Executions
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        if (name === "generate_proposal") {
            const { filePath, businessPurpose } = args;
            if (!fs.existsSync(filePath))
                return { isError: true, content: [{ type: "text", text: `File not found.` }] };
            const xml = fs.readFileSync(filePath, "utf-8");
            const labelMatch = xml.match(/<label>([\s\(\S\)]*?)<\/label>/);
            const label = labelMatch ? labelMatch[1].trim() : "this field";
            const typeMatch = xml.match(/<type>([\s\(\S\)]*?)<\/type>/);
            const type = typeMatch ? typeMatch[1].trim() : "Field";
            // Formulate a strict structural NLP prompt for local execution
            const nlpPrompt = `
        You are a Salesforce System Architect. Generate a professional, clean documentation layout for a custom field based on these details:
        Field Label: ${label}
        Field Type: ${type}
        Business Context: ${businessPurpose}

        Respond ONLY with a valid JSON object containing exactly two keys: "description" and "helpText". Do not include any markdown styling, conversational text, or backticks.
        
        Constraints:
        - "description": Technical summary of what data this field stores and why for auditors (Max 1000 characters).
        - "helpText": Action-oriented guidance helping users fill out the field in the Salesforce UI (Max 255 characters).
      `;
            // Call the local model directly using the official client syntax
            const response = await ollama_1.default.chat({
                model: "phi3:mini",
                messages: [{ role: "user", content: nlpPrompt }],
                options: { temperature: 0.3 }
            });
            const responseText = response.message.content;
            // Clean up any rogue structural formatting context around the JSON block
            const cleanJsonString = responseText.substring(responseText.indexOf("{"), responseText.lastIndexOf("}") + 1);
            const parsedNlp = JSON.parse(cleanJsonString);
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify({
                            label,
                            type,
                            proposedDesc: parsedNlp.description,
                            proposedHelp: parsedNlp.helpText,
                            filePath
                        }, null, 2)
                    }]
            };
        }
        if (name === "save_metadata_changes") {
            const input = args;
            let xml = fs.readFileSync(input.filePath, "utf-8");
            if (input.updateDescription)
                xml = upsertTag(xml, "description", input.description);
            if (input.updateHelpText)
                xml = upsertTag(xml, "inlineHelpText", input.inlineHelpText);
            fs.writeFileSync(input.filePath, xml, "utf-8");
            return { content: [{ type: "text", text: "Successfully saved local NLP documentation updates!" }] };
        }
        throw new Error("Tool not found");
    }
    catch (err) {
        return { isError: true, content: [{ type: "text", text: `Error processing local NLP: ${err.message}` }] };
    }
});
// Bootstrapping function
async function bootstrap() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error("Local NLP Step Documenter running.");
}
bootstrap().catch(err => console.error("Start error:", err));
