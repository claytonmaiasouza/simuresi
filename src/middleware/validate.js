// Wraps a zod schema into an Express middleware that validates req.body,
// replacing it with the parsed (and thus type-coerced/defaulted) value on
// success, or responding 400 with the first issue on failure.
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const first = result.error.issues[0];
      return res.status(400).json({
        error: "invalid_input",
        detail: first ? `${first.path.join(".")}: ${first.message}` : "invalid_input",
      });
    }
    req.body = result.data;
    next();
  };
}

function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      const first = result.error.issues[0];
      return res.status(400).json({
        error: "invalid_input",
        detail: first ? `${first.path.join(".")}: ${first.message}` : "invalid_input",
      });
    }
    req.params = result.data;
    next();
  };
}

module.exports = { validateBody, validateParams };
