const vscode = require("vscode");
const fs = require("fs");
const fsp = fs.promises;
const { exec, ChildProcess } = require("child_process");
const path = require("path");
const glob = require("glob");
const pkg = require("./package.json");

const cmdPrefix = "droidscript-docs.";
const titlePrefix = "DroidScript Docs: ";
const commands = ["generateDocs", "clean", "update"];
/** @type {CmdMap} */
const cmdMap = Object.assign({}, ...pkg.contributes.commands.map(c =>
    ({ [c.command.replace(cmdPrefix, "")]: c.title.replace(titlePrefix, "") })
));

let folderPath = "";
let generateJSFilePath = "files/generate.js";
let jsdocParserFilePath = "files/jsdoc-parser.js";
let confPath = "files/conf.json";

/** @type {vscode.StatusBarItem} */
let generateBtn;
/** @type {vscode.WebviewPanel} */
let webViewPanel;

let languageFilter = "*", versionFilter = "*", scopeFilter = "*", nameFilter = "*";
let lastCommand = "", working = false;

/** @type {DSConfig} */
let conf;
/** @type {Obj<string>} */
let tnames = {};

const chn = vscode.window.createOutputChannel("Docs Debug");

/** @param {vscode.ExtensionContext} context */
function activate(context) {
    if (!vscode.workspace.workspaceFolders) return;
    const cw = vscode.workspace.workspaceFolders[0];
    if (!cw || !cw.name) return;

    folderPath = cw.uri.fsPath;
    generateJSFilePath = path.join(folderPath, generateJSFilePath);
    jsdocParserFilePath = path.join(folderPath, jsdocParserFilePath);
    confPath = path.join(folderPath, confPath);

    if (!fs.existsSync(generateJSFilePath)) return;
    if (!fs.existsSync(jsdocParserFilePath)) return;
    if (!fs.existsSync(confPath)) return;

    fs.readFile(confPath, "utf8", async (err, data) => {
        let error = "";
        if (err) error = err.name + ": " + err.message;
        else try {
            conf = JSON.parse(data);
            Object.assign(tnames, conf.tname, conf.tdesc);
        }
        catch (e) { error = "Reading conf.json: " + e.message; }
        if (error) await vscode.window.showErrorMessage(error);
    });

    generateBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    generateBtn.command = cmdPrefix + "selectCommand";
    generateBtn.text = "$(tools) Docs: Select";
    generateBtn.tooltip = "Select Command";
    generateBtn.show();

    vscode.workspace.onDidChangeTextDocument(event => {
        // Handle the event, for example, update the status bar icon
        //generateBtn.text = "$(tools) Generate Docs";
        //generateBtn.tooltip = cmdMap.generateDocs;
    });

    /** @type {(cmd:string, cb:()=>any) => void} */
    const subscribe = (cmd, cb) => {
        context.subscriptions.push(vscode.commands.registerCommand(cmdPrefix + cmd, () => (lastCommand = cmd, cb())));
    };

    subscribe("generateDocs", () => generate({ clear: true }));
    subscribe("clean", () => generate({ clean: true }));
    subscribe("update", () => generate({ update: true }));
    subscribe("selectCommand", selectCommand);
    subscribe("filterLanguage", () => selectFilter("files/json/*", "Pick Language").then(s => s && (languageFilter = s)));
    subscribe("filterVersion", () => selectFilter("files/json/*/*", "Pick Version").then(s => s && (versionFilter = s)));
    subscribe("filterScope", () => selectFilter("files/json/*/*/*", "Pick Scope").then(s => s && (scopeFilter = s)));

    vscode.languages.registerCompletionItemProvider('javascript', {
        provideCompletionItems
    });
}

// This method is called when your extension is deactivated
function deactivate() {
    generateBtn.dispose();
    webViewPanel.dispose();
}

const generateOptions = { clean: false, clear: false, update: false };
/** @param {Partial<typeof generateOptions>} [options] */
function generate(options = generateOptions) {
    options = Object.assign(generateOptions, options);

    working = true;
    generateBtn.text = "$(sync~spin) Docs";
    generateBtn.tooltip = "Task: " + cmdMap[lastCommand];

    chn.clear();
    chn.show();
    vscode.commands.executeCommand('livePreview.end');

    // Execute the Docs/files/jsdoc-parser.js file
    processHandler(exec(`node ${jsdocParserFilePath}`, (error, stdout, stderr) => {
        if (error) return console.log(`Error: ${error.message}`);
        let optionStr = "";
        const filters = [languageFilter, scopeFilter];
        const filter = filters.filter(f => f != "*").join(".");
        if (options.clean) optionStr += " -C";
        if (options.clear) optionStr += " -c";
        if (options.update) optionStr += " -u";
        if (versionFilter != "*") optionStr += ` -v=${versionFilter}`;

        // Execute the Docs/files/generate.js file
        processHandler(exec(`node ${generateJSFilePath}${optionStr} ${filter}`, (error, stdout, stderr) => {
            if (error) return console.error(`Error: ${error.message}`);
            working = false;
            generateBtn.text = "$(check) Docs: Done";
            if ("generateDocs,update,".includes(lastCommand + ",")) openWithLiveServer();
        }));
    }));
}

/** @param {ChildProcess} cp */
function processHandler(cp) {
    cp.stdout?.on("data", data => chn.append(data.replace(/\x1b\[[0-9;]*[a-z]/gi, '')))
    cp.stderr?.on("data", data => chn.append(data.replace(/\x1b\[[0-9;]*[a-z]/gi, '')))
}

/** @param {string} name */
const hidden = (name) => /^[~.]/.test(name[0]);

/** @type {(path:string, title:string) => Promise<string | undefined>} */
async function selectFilter(pathGlob, title) {
    const globPath = path.join(folderPath, ...pathGlob.split("/"));
    const dirs = glob.sync(globPath, { windowsPathsNoEscape: true, withFileTypes: true });
    const items = dirs.filter(d => d.isDirectory() && !hidden(d.name)).map(d => d.name);
    items.push("*");
    return await vscode.window.showQuickPick(items, {
        canPickMany: false, title, placeHolder: "* (all)"
    });
}

async function selectCommand() {
    const items = commands.map(c => cmdMap[c]);
    const title = await vscode.window.showQuickPick(items, {
        canPickMany: false, title: "Select Command", placeHolder: "Generate"
    });
    const cmd = pkg.contributes.commands.find(c => c.title == titlePrefix + title);
    if (!cmd) return;
    await vscode.commands.executeCommand(cmd.command);
}

async function openWithLiveServer() {
    const docsPath = path.join(folderPath, "out", "docs", "Docs.htm");
    if (!fs.existsSync(docsPath)) return;
    const fileUri = vscode.Uri.file(docsPath);
    await vscode.commands.executeCommand('livePreview.start.preview.atFile', fileUri);
}

/** @type {vscode.CompletionItemProvider["provideCompletionItems"]} */
function provideCompletionItems(doc, pos, token, context) {
    const ln = pos.line;
    const cd = doc.lineAt(ln).text;

    if (!cd.includes("@param") && !cd.includes("@return")) return;

    const completionItems = Object.keys(tnames).map(m => {
        return new vscode.CompletionItem(m, vscode.CompletionItemKind.Property);
    });

    // Customize your completion items
    completionItems.forEach(item => {
        let a = typeof item.label == "string" ? item.label : item.label.label;
        item.insertText = a;
        let b = a.includes("_") ? a.split("_")[0] : "";
        item.detail = b ? tnames[b] + " : " + tnames[a] : tnames[a];
    });

    // Add more completion items as needed

    return completionItems;
}

module.exports = {
    activate,
    deactivate
}
