// Minimal terminal prompts for the setup scripts. Works interactively (with hidden
// password input) and with piped input, one answer per line.
const readline = require('readline');

function createPrompter() {
    const interactive = Boolean(process.stdin.isTTY);

    if (!interactive) {
        const lines = require('fs').readFileSync(0, 'utf8').split(/\r?\n/);
        return {
            interactive,
            async ask(question, { defaultValue } = {}) {
                const answer = (lines.shift() || '').trim();
                process.stdout.write(`${question}${defaultValue ? ` [${defaultValue}]` : ''}: \n`);
                return answer || defaultValue || '';
            },
            close() {}
        };
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = function writeToOutput(text) {
        if (!muted || text.includes('\n')) rl.output.write(muted ? '\n' : text);
    };

    return {
        interactive,
        ask(question, { defaultValue, secret = false } = {}) {
            return new Promise((resolve) => {
                rl.question(`${question}${defaultValue ? ` [${defaultValue}]` : ''}: `, (answer) => {
                    muted = false;
                    resolve(answer.trim() || defaultValue || '');
                });
                muted = secret;
            });
        },
        close() {
            rl.close();
        }
    };
}

// Asks until `parse` accepts the answer. With piped input an invalid answer stops the script.
async function askValid(prompter, question, parse, options = {}) {
    for (;;) {
        const answer = await prompter.ask(question, options);
        try {
            return parse(answer);
        } catch (err) {
            if (!prompter.interactive) throw err;
            console.log(`  ✗ ${err.message}`);
        }
    }
}

module.exports = { createPrompter, askValid };
