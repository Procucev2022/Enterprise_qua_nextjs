/**
 * Jest replacement for the `dotenv` package.
 *
 * Backend tests must not read the developer's gitignored `backend/.env`. Modules
 * such as src/app.js call `dotenv.config()` while they load, which would copy local
 * values into process.env for the whole run. A test could then pass on a laptop and
 * fail in CI, where no .env file exists. jest.config.js maps `dotenv` to this stub,
 * so every test process behaves like CI. Suites that exercise dotenv directly
 * replace it with `jest.doMock('dotenv', ...)`.
 */
module.exports = {
  config: () => ({ parsed: {} }),
};
