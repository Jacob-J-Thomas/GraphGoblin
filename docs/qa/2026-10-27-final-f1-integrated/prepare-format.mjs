// Extend only the copied recording CLI fixture to answer the shipped JSON schemas.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));let s=fs.readFileSync(path.join(here,'session-cli.cs'),'utf8');
const old='text = route.Success ? "{\\"route\\":" + Q(route.Groups[1].Value) + ",\\"confidence\\":0.9,\\"reasoning\\":\\"synthetic\\"}" : "{}";';
if(!s.includes(old))throw Error('fixture edit anchor');
const replacement=old+String.raw`
      foreach (var field in new[] { "status", "assessment" }) {
        var choice = Regex.Match(schema, "\\\"" + field + "\\\"\\s*:\\s*\\{[^}]*?\\\"enum\\\"\\s*:\\s*\\[\\s*\\\"([^\\\"]+)\\\"");
        if (!choice.Success) continue;
        text = "{\"" + field + "\":" + Q(choice.Groups[1].Value) + ",\"summary\":\"Synthetic F1 fixture response\"";
        foreach (var array in new[] { "findings", "checks", "evidence" })
          if (schema.Contains("\"" + array + "\"")) text += ",\"" + array + "\":[]";
        text += "}";
      }
`;
fs.writeFileSync(path.join(here,'format-cli.cs'),s.replace(old,replacement),'utf8');
