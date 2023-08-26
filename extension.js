const vscode = require("vscode");
const fs = require("fs");
const fsp = fs.promises;
const { exec, ChildProcess } = require("child_process");
const path = require("path");
const glob = require("glob");
const pkg = require("./package.json");

const cmdPrefix = "droidscript-docs.";
const titlePrefix = "DroidScript Docs: ";
const commands = ["generateDocs", "clean", "update", "allCommands"];
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
    generateBtn.text = "$(tools) Generate Docs";
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
    subscribe("allCommands", selectCommand.bind(null, true));
    subscribe("filterLanguage", () => selectFilter(conf.langs, "Pick Language", languageFilter).then(s => s && (languageFilter = s)));
    subscribe("filterVersion", () => selectFilter(conf.vers, "Pick Version", versionFilter).then(s => s && (versionFilter = s)));
    subscribe("filterScope", () => selectFilter(conf.scopes, "Pick Scope", scopeFilter).then(s => s && (scopeFilter = s)));
    subscribe("filterName", enterNameFilter);
    subscribe("preview", openWithLiveServer);

    vscode.languages.registerCompletionItemProvider('javascript', { provideCompletionItems });
    vscode.languages.registerCompletionItemProvider('markdown', { provideCompletionItems });
}

// This method is called when your extension is deactivated
function deactivate() {
    generateBtn.dispose();
    webViewPanel.dispose();
    vscode.commands.executeCommand('livePreview.end');
}

const generateOptions = { clean: false, clear: false, update: false };
/** @param {Partial<typeof generateOptions>} [options] */
async function generate(options = generateOptions) {
    options = Object.assign(generateOptions, options);

    working = true;
    generateBtn.text = "$(sync~spin) Docs";
    generateBtn.tooltip = "Task: " + cmdMap[lastCommand];

    chn.clear();
    chn.show();
    if (nameFilter != "*") vscode.commands.executeCommand('livePreview.end');

    // Execute the Docs/files/jsdoc-parser.js file
    try { await processHandler(exec(`node ${jsdocParserFilePath}`)); }
    catch (error) {
        await vscode.window.showErrorMessage(`Error: ${error.message || error}`);
        return updateTooltip();
    }

    let optionStr = "";
    const filters = [languageFilter, scopeFilter];
    const filter = filters.filter(f => f != "*").join(".");
    if (options.clean) optionStr += " -C";
    if (options.clear) optionStr += " -c";
    if (options.update) optionStr += " -u";
    if (versionFilter != "*") optionStr += ` -v=${versionFilter}`;

    try { await processHandler(exec(`node ${generateJSFilePath}${optionStr} ${filter}`)); }
    catch (error) {
        await vscode.window.showErrorMessage(`Error: ${error.message || error}`);
        return updateTooltip();
    }

    working = false;
    generateBtn.text = "$(check) Docs: Done";
    if ("generateDocs,update,".includes(lastCommand + ",")) openWithLiveServer();
    updateTooltip();
}

/** 
 * @param {ChildProcess} cp 
 * @returns {Promise<number>} 
 */
function processHandler(cp) {
    cp.stdout?.on("data", data => chn.append(data.replace(/\x1b\[[0-9;]*[a-z]/gi, '')));
    cp.stderr?.on("data", data => chn.append(data.replace(/\x1b\[[0-9;]*[a-z]/gi, '')));
    let error = false;
    return new Promise((res, rej) => {
        cp.on("error", e => (error = true, rej(e)));
        cp.on("exit", code => error || res(code || 0));
    });
}

function updateTooltip() {
    const filter = `language: ${languageFilter}\nversion: ${versionFilter}\nscope: ${scopeFilter}\nname: ${nameFilter}`;
    generateBtn.tooltip = `Generate Filter\n${filter}`;
}

/** @type {(list:string[]|Obj<string>, title:string, dflt?:string) => Promise<string | undefined>} */
async function selectFilter(list, title, dflt = "*") {
    const items = Object.values(list);
    if (!Array.isArray(list)) Object.keys(list).forEach((k, i) => items[i] = `${k} (${items[i]})`)
    items.push("* (all)");

    let placeHolder = items.find(s => s.includes(dflt)) || "all (*)";
    const res = await vscode.window.showQuickPick(items, {
        canPickMany: false, title, placeHolder
    });
    setTimeout(updateTooltip, 100);
    return res && res.split(' ')[0];
}

async function selectCommand(all = false) {
    const items = all ? Object.values(cmdMap) : commands.map(c => cmdMap[c]);
    const title = await vscode.window.showQuickPick(items, {
        canPickMany: false, title: "Select Command", placeHolder: "Generate"
    });
    const cmd = pkg.contributes.commands.find(c => c.title == titlePrefix + title);
    if (!cmd) return;
    await vscode.commands.executeCommand(cmd.command);
}

async function enterNameFilter() {
    const pattern = await vscode.window.showInputBox({
        title: "Enter Pattern", placeHolder: "Create*"
    });
    if (!pattern) return;

    try {
        nameFilter = RegExp(pattern).source;
        updateTooltip();
    }
    catch (e) {
        await vscode.window.showErrorMessage("Invalid RegExp Pattern: " + pattern);
    }
}

function langDir(l = languageFilter) { return l == "*" || l == "en" ? "docs" : "docs-" + l; }

/** @type {(lang:string, ver:string, scope:string, name:string) => string} */
function getServerPath(lang, ver, scope, name) {
    const subPath = ["out"];
    const langs = Object.keys(conf.langs);
    subPath.push(langDir(lang == "*" ? langs[0] : lang));
    subPath.push(ver == "*" ? conf.vers[0] : ver);

    if (name == "*")
        subPath.push(scope == "*" ? "Docs.htm" : conf.scopes[scope].replace(/\s/g, "") + ".htm");
    else {
        const globPath = path.join(folderPath, ...subPath, scope, '*' + name.replace(/\.\*/g, "*") + '*');
        const files = glob.sync(globPath, { windowsPathsNoEscape: true });
        const scopeName = path.basename(path.dirname(files[0] || "*"));
        if (files.length == 1) subPath.push(scopeName, path.basename(files[0]))
        else subPath.push("Docs.htm");
    }

    return path.join(folderPath, ...subPath);
}

async function openWithLiveServer() {
    const docsPath = getServerPath(languageFilter, versionFilter, scopeFilter, nameFilter);
    if (!fs.existsSync(docsPath)) return;
    const fileUri = vscode.Uri.file(docsPath);
    await vscode.commands.executeCommand('livePreview.start.preview.atFile', fileUri);
}

/** @type {vscode.CompletionItemProvider["provideCompletionItems"]} */
function provideCompletionItems(doc, pos, token, context) {
    const ln = pos.line;
    const cd = doc.lineAt(ln).text;
    const area = cd.slice(Math.max(pos.character - 12, 0), pos.character);

    if (!cd.includes("@param") && !cd.includes("@return") && !area.match(/\w+(:|\|\|)\w*/)) return;

    const completionItems = Object.keys(tnames).map(a => {
        const item = new vscode.CompletionItem(a, vscode.CompletionItemKind.Property);
        let b = a.split(/\\?_/)[0];
        item.detail = b ? tnames[b] + ": " + tnames[a] : tnames[a];
        return item;
    });

    return completionItems;
}

module.exports = {
    activate,
    deactivate
}
