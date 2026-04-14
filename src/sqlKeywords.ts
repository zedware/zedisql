export const PG_KEYWORDS = new Set([
  "ABORT", "ABSOLUTE", "ACCESS", "ACTION", "ADD", "ADMIN", "AFTER", "AGGREGATE", "ALL", "ALSO", "ALTER", "ALWAYS", "ANALYSE", "ANALYZE", "AND", "ANY", "ARRAY", "AS", "ASC", "ASSERTION", "ASSIGNMENT", "ASYMMETRIC", "AT", "ATTACH", "ATTRIBUTE", "AUTHORIZATION",
  "BACKWARD", "BEFORE", "BEGIN", "BETWEEN", "BIGINT", "BINARY", "BIT", "BOOLEAN", "BOTH", "BY",
  "CACHE", "CALL", "CALLED", "CASCADE", "CASCADED", "CASE", "CAST", "CATALOG", "CHAIN", "CHAR", "CHARACTER", "CHARACTERISTICS", "CHECK", "CHECKPOINT", "CLASS", "CLOSE", "CLUSTER", "COALESCE", "COLLATE", "COLLATION", "COLUMN", "COLUMNS", "COMMENT", "COMMENTS", "COMMIT", "COMMITTED", "CONCURRENTLY", "CONFIGURATION", "CONFLICT", "CONNECTION", "CONSTRAINT", "CONSTRAINTS", "CONTENT", "CONTINUE", "CONVERSION", "COPY", "COST", "CREATE", "CROSS", "CSV", "CUBE", "CURRENT", "CURRENT_CATALOG", "CURRENT_DATE", "CURRENT_ROLE", "CURRENT_SCHEMA", "CURRENT_TIME", "CURRENT_TIMESTAMP", "CURRENT_USER", "CURSOR", "CYCLE",
  "DATA", "DATABASE", "DATABASES", "DAY", "DEALLOCATE", "DEC", "DECIMAL", "DECLARE", "DEFAULT", "DEFAULTS", "DEFERRABLE", "DEFERRED", "DEFINER", "DELETE", "DELIMITER", "DELIMITERS", "DEPENDS", "DESC", "DETACH", "DICTIONARY", "DISABLE", "DISCARD", "DISTINCT", "DO", "DOCUMENT", "DOMAIN", "DOUBLE", "DROP",
  "EACH", "ELSE", "ENABLE", "ENCODING", "ENCRYPTED", "END", "ENUM", "ESCAPE", "EVENT", "EXCEPT", "EXCLUDE", "EXCLUDING", "EXCLUSIVE", "EXECUTE", "EXISTS", "EXPLAIN", "EXPRESSION", "EXTENSION", "EXTERNAL", "EXTRACT",
  "FALSE", "FAMILY", "FETCH", "FILTER", "FIRST", "FLOAT", "FOLLOWING", "FOR", "FORCE", "FOREIGN", "FORWARD", "FREEZE", "FROM", "FULL", "FUNCTION", "FUNCTIONS",
  "GENERATED", "GLOBAL", "GRANT", "GRANTED", "GREATEST", "GROUP", "GROUPING", "GROUPS",
  "HANDLER", "HAVING", "HEADER", "HOLD", "HOUR",
  "IDENTITY", "IF", "ILIKE", "IMMEDIATE", "IMMUTABLE", "IMPLICIT", "IMPORT", "IN", "INCLUDE", "INCLUDING", "INCREMENT", "INDEX", "INDEXES", "INHERIT", "INHERITS", "INITIALLY", "INLINE", "INNER", "INOUT", "INPUT", "INSENSITIVE", "INSERT", "INSTEAD", "INT", "INTEGER", "INTERSECT", "INTERVAL", "INTO", "INVOKER", "IS", "ISNULL", "ISOLATION",
  "JOIN",
  "KEY",
  "LABEL", "LANGUAGE", "LARGE", "LAST", "LATERAL", "LEADING", "LEAST", "LEFT", "LEVEL", "LIKE", "LIMIT", "LISTEN", "LOAD", "LOCAL", "LOCALTIME", "LOCALTIMESTAMP", "LOCATION", "LOCK", "LOCKED", "LOGGED",
  "MAPPING", "MATCH", "MATERIALIZED", "MAXVALUE", "METHOD", "MINUTE", "MINVALUE", "MODE", "MONTH", "MOVE",
  "NAME", "NAMES", "NATIONAL", "NATURAL", "NCHAR", "NEW", "NEXT", "NO", "NONE", "NOT", "NOTHING", "NOTIFY", "NOTNULL", "NOWAIT", "NULL", "NULLIF", "NULLS", "NUMERIC",
  "OBJECT", "OF", "OFF", "OFFSET", "OIDS", "OLD", "ON", "ONLY", "OPERATOR", "OPTION", "OPTIONS", "OR", "ORDER", "ORDINALITY", "OTHERS", "OUT", "OUTER", "OVER", "OVERLAPS", "OVERLAY", "OVERRIDING", "OWNED", "OWNER",
  "PARALLEL", "PARSER", "PARTIAL", "PARTITION", "PASSING", "PASSWORD", "PLACING", "PLANS", "POLICY", "POSITION", "PRECEDING", "PRECISION", "PREPARE", "PREPARED", "PRESERVE", "PRIMARY", "PRIOR", "PRIVILEGES", "PROCEDURAL", "PROCEDURE", "PROCEDURES", "PROGRAM", "PUBLICATION",
  "QUOTE",
  "RANGE", "READ", "REAL", "REASSIGN", "RECHECK", "RECURSIVE", "REF", "REFERENCES", "REFERENCING", "REFRESH", "REINDEX", "RELATIVE", "RELEASE", "RENAME", "REPEATABLE", "REPLACE", "REPLICA", "RESET", "RESTART", "RESTRICT", "RETURNING", "RETURNS", "REVOKE", "RIGHT", "ROLE", "ROLLBACK", "ROLLUP", "ROUTINE", "ROUTINES", "ROW", "ROWS", "RULE",
  "SAVEPOINT", "SCHEMA", "SCHEMAS", "SCROLL", "SEARCH", "SECOND", "SECURITY", "SELECT", "SEQUENCE", "SEQUENCES", "SERIALIZABLE", "SERVER", "SESSION", "SESSION_USER", "SET", "SETOF", "SETS", "SHARE", "SHOW", "SIMILAR", "SIMPLE", "SKIP", "SMALLINT", "SNAPSHOT", "SOME", "SQL", "STABLE", "STANDALONE", "START", "STATEMENT", "STATISTICS", "STDIN", "STDOUT", "STORAGE", "STRICT", "STRIP", "SUBSCRIPTION", "SUBSTRING", "SUPPORT", "SYMMETRIC", "SYSID", "SYSTEM",
  "TABLE", "TABLES", "TABLESAMPLE", "TABLESPACE", "TEMP", "TEMPLATE", "TEMPORARY", "TEXT", "THEN", "TIES", "TIME", "TIMESTAMP", "TO", "TRAILING", "TRANSACTION", "TRANSFORM", "TREAT", "TRIGGER", "TRIM", "TRUE", "TRUNCATE", "TRUSTED", "TYPE", "TYPES",
  "UNBOUNDED", "UNCOMMITTED", "UNENCRYPTED", "UNION", "UNIQUE", "UNKNOWN", "UNLISTEN", "UNLOGGED", "UNTIL", "UPDATE", "USER", "USING",
  "VACUUM", "VALID", "VALIDATE", "VALUE", "VALUES", "VARCHAR", "VARIADIC", "VARYING", "VERBOSE", "VERSION", "VIEW", "VIEWS", "VOLATILE",
  "WHEN", "WHERE", "WHITESPACE", "WINDOW", "WITH", "WITHIN", "WITHOUT", "WORK", "WRAPPER", "WRITE",
  "XML", "XMLATTRIBUTES", "XMLCONCAT", "XMLELEMENT", "XMLEXISTS", "XMLFOREST", "XMLNAMESPACES", "XMLPARSE", "XMLPI", "XMLROOT", "XMLSERIALIZE", "XMLTABLE",
  "YEAR", "YES", "ZONE"
]);

export const PG_FUNCTIONS = new Set([
  "abs", "cbrt", "ceil", "ceiling", "degrees", "div", "exp", "floor", "ln", "log", "mod", "pi", "power", "radians", "round", "sign", "sqrt", "trunc", "random", "setseed",
  "acos", "asin", "atan", "atan2", "cos", "cot", "sin", "tan",
  "length", "char_length", "character_length", "lower", "upper", "initcap", "left", "right", "lpad", "rpad", "ltrim", "rtrim", "btrim", "split_part", "strpos", "substr", "translate", "ascii", "chr", "concat", "concat_ws", "format", "md5",
  "to_char", "to_date", "to_number", "to_timestamp",
  "now", "age", "clock_timestamp", "current_date", "current_time", "current_timestamp", "date_part", "date_trunc", "extract", "isfinite", "justify_days", "justify_hours", "justify_interval", "localtime", "localtimestamp", "make_date", "make_interval", "make_time", "make_timestamp", "make_timestamptz",
  "array_append", "array_cat", "array_ndims", "array_dims", "array_fill", "array_length", "array_lower", "array_position", "array_positions", "array_prepend", "array_remove", "array_replace", "array_to_string", "array_upper", "cardinality", "string_to_array", "unnest",
  "count", "sum", "avg", "min", "max", "string_agg", "array_agg", "json_agg", "jsonb_agg", "json_object_agg", "jsonb_object_agg", "xmlagg", "bit_and", "bit_or", "bool_and", "bool_or", "every",
  "row_number", "rank", "dense_rank", "percent_rank", "cume_dist", "ntile", "lag", "lead", "first_value", "last_value", "nth_value",
  "json_build_array", "json_build_object", "json_extract_path", "json_extract_path_text", "json_object_keys", "json_populate_record", "json_populate_recordset", "json_array_elements", "json_array_elements_text", "json_typeof", "json_strip_nulls",
  "jsonb_build_array", "jsonb_build_object", "jsonb_extract_path", "jsonb_extract_path_text", "jsonb_object_keys", "jsonb_populate_record", "jsonb_populate_recordset", "jsonb_array_elements", "jsonb_array_elements_text", "jsonb_typeof", "jsonb_strip_nulls", "jsonb_set", "jsonb_insert", "jsonb_delete", "jsonb_pretty",
  "coalesce", "nullif", "greatest", "least"
]);

export const PG_TYPES = new Set([
  "bigint", "int8", "bigserial", "serial8", "bit", "bit varying", "varbit", "boolean", "bool", "box", "bytea", "character", "char", "character varying", "varchar", "cidr", "circle", "date", "double precision", "float8", "inet", "integer", "int", "int4", "interval", "json", "jsonb", "line", "lseg", "macaddr", "macaddr8", "money", "numeric", "decimal", "path", "pg_lsn", "pg_snapshot", "point", "polygon", "real", "float4", "smallint", "int2", "smallserial", "serial2", "serial", "serial4", "text", "time", "time with time zone", "timetz", "time without time zone", "timestamp", "timestamp with time zone", "timestamptz", "timestamp without time zone", "tsquery", "tsvector", "txid_snapshot", "uuid", "xml"
]);
