// The tools the AI agent can use to build apps.
const str = (description) => ({ type: 'string', description });

export const TOOL_DEFS = [
  {
    name: 'write_file',
    description:
      'Create or overwrite a file in the project. Always pass the COMPLETE file content.',
    input_schema: {
      type: 'object',
      properties: {
        path: str('Relative file path, e.g. index.html or src/app.js'),
        content: str('The complete file content'),
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the current content of a file.',
    input_schema: {
      type: 'object',
      properties: { path: str('Relative file path') },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description: 'List all files in the project.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'delete_file',
    description: 'Delete a file from the project.',
    input_schema: {
      type: 'object',
      properties: { path: str('Relative file path') },
      required: ['path'],
    },
  },
  {
    name: 'finish',
    description:
      'Call this when the task is complete. Provide a short summary for the user.',
    input_schema: {
      type: 'object',
      properties: { summary: str('1-3 sentence summary for the user') },
      required: ['summary'],
    },
  },
];

export function executeTool(call, ws, projectId) {
  const input = call.input || {};
  try {
    switch (call.name) {
      case 'write_file': {
        const n = ws.writeFile(projectId, input.path, input.content ?? '');
        return {
          output: 'Wrote ' + n + ' bytes to ' + input.path,
          summary: 'Wrote ' + input.path + ' (' + n + ' bytes)',
          isError: false,
        };
      }
      case 'read_file': {
        const c = ws.readFile(projectId, input.path);
        return { output: c.slice(0, 60000), summary: 'Read ' + input.path, isError: false };
      }
      case 'list_files': {
        const t = ws.tree(projectId);
        return {
          output: t.map((f) => f.path + ' (' + f.size + 'B)').join('\n') || '(empty project)',
          summary: 'Listed ' + t.length + ' file(s)',
          isError: false,
        };
      }
      case 'delete_file': {
        ws.deleteFile(projectId, input.path);
        return { output: 'Deleted ' + input.path, summary: 'Deleted ' + input.path, isError: false };
      }
      case 'finish': {
        return {
          output: 'ok',
          summary: input.summary || 'Done',
          isError: false,
          finish: true,
        };
      }
      default:
        return {
          output: 'Unknown tool: ' + call.name,
          summary: 'Unknown tool ' + call.name,
          isError: true,
        };
    }
  } catch (e) {
    const msg = String((e && e.message) || e);
    return { output: 'Error: ' + msg, summary: 'Failed ' + call.name + ': ' + msg, isError: true };
  }
}
