import { Icon } from "./Icon";
import { inferSchema, type SchemaNode } from "../utils/schema";
import { parseJsonValue } from "../utils/json";

function SchemaTree({
  name,
  schema,
  depth = 0,
}: {
  name?: string;
  schema: SchemaNode;
  depth?: number;
}) {
  const isObject = schema.type === "object";
  const isArray = schema.type === "array";
  const entries = schema.properties ? Object.entries(schema.properties) : [];

  return (
    <div className="schema-node" style={{ paddingLeft: `${depth * 18}px` }}>
      <div className="schema-row">
        {name && <span className="schema-key">{name}</span>}
        <span className="schema-type">{schema.type}</span>
        {isArray && schema.items && (
          <span className="schema-detail">&lt;{schema.items.type}&gt;</span>
        )}
      </div>
      {isObject &&
        entries.map(([key, child]) => (
          <SchemaTree key={key} name={key} schema={child} depth={depth + 1} />
        ))}
      {isArray &&
        schema.items &&
        schema.items.type === "object" &&
        schema.items.properties &&
        Object.entries(schema.items.properties).map(([key, child]) => (
          <SchemaTree key={key} name={key} schema={child} depth={depth + 1} />
        ))}
    </div>
  );
}

export function SchemaViewer({ value }: { value: string | null | undefined }) {
  const parsed = parseJsonValue(value);
  if (parsed === null || typeof parsed === "string") {
    return (
      <div className="schema-empty">
        <Icon name="code" className="h-5 w-5" />
        <p>Schema inference is available for JSON payloads.</p>
      </div>
    );
  }
  return (
    <div className="schema-viewer">
      <SchemaTree schema={inferSchema(parsed)} />
    </div>
  );
}
