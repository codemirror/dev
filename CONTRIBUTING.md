# How to contribute

- [Getting help](#getting-help)
- [Submitting bug reports](#submitting-bug-reports)
- [Contributing code](#contributing-code)

## Getting help

Community discussion, questions, and informal bug reporting is done on
the [discuss.CodeMirror forum](http://discuss.codemirror.net).

## Submitting bug reports

Report bugs on the
[issue tracker](https://code.haverbeke.berlin/codemirror/dev/issues).
Before reporting a bug, please read these pointers.

- The issue tracker is for *bugs*, not requests for help. Questions
  should be asked on the [forum](http://discuss.codemirror.net).

- Include information about the version of the code that exhibits the
  problem. For browser-related issues, include the browser, browser
  version, and operating system on which the problem occurred.

- Mention very precisely what went wrong. "X is broken" is not a good
  bug report. What did you expect to happen? What happened instead?
  Describe the exact steps a maintainer has to take to make the
  problem occur. A screencast can be useful, but is no substitute for
  a textual description.

- A great way to make it easy to reproduce your problem, if it can not
  be trivially reproduced on the website demos, is to submit a script
  that triggers the issue. The easiest way do do that is our
  [sandbox](https://codemirror.net/try/).

## Contributing code

Code written by "AI" language models (either partially or fully) is
**not welcome**. Both because you cannot guarantee it's not parroting
copyrighted content, and because it tends to be of low quality and a
waste of time to review.

- Make sure you have a [Codeberg](https://codeberg.org/user/sign_up)
  or [GitHub](https://github.com/signup/free) account.
  
- Use that to create a [code.haverbeke.berlin
  account](https://code.haverbeke.berlin/user/login).

- Fork the relevant repository.

- Create a local checkout of the code. You can use the
  [dev repository](https://code.haverbeke.berlin/codemirror/dev) to
  easily check out all core modules.

- Make your changes, and commit them

- Follow the code style of the rest of the project (see below).

- If your changes are easy to test or likely to regress, add tests in
  the relevant `test/` directory. Either put them in an existing
  `test-*.js` file, if they fit there, or add a new file.

- Make sure all tests pass. Run `npm run test` to verify tests pass.

- Submit a pull request. Don't put more than one feature/fix in a
  single pull request.

By contributing code to CodeMirror you

 - Agree to license the contributed code under the project's [MIT
   license](https://code.haverbeke.berlin/codemirror/dev/src/branch/main/LICENSE).

 - Confirm that you have the right to contribute and license the code
   in question. (Either you hold all rights on the code, or the rights
   holder has explicitly granted the right to use it like this,
   through a compatible open source license or through a direct
   agreement with you.)

### Coding standards

- TypeScript, targeting an ES2018 runtime (i.e. don't use library
  elements added after ES2018).

- 2 spaces per indentation level, no tabs.

- No semicolons except when necessary.

- Follow the surrounding code when it comes to spacing, brace
  placement, etc.

- Brace-less single-statement bodies are encouraged (whenever they
  don't impact readability).

- [getdocs](https://code.haverbeke.berlin/marijn/getdocs-ts)-style doc
  comments above items that are part of the public API.

- CodeMirror does *not* follow JSHint or JSLint prescribed style.
  Patches that try to 'fix' code to pass one of these linters will not
  be accepted.
