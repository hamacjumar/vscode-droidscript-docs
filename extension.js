const vscode = require("vscode");
const fs = require("fs");
const { exec } = require("child_process");
const path = require("path");

let folderPath = "";
let generateJSFilePath = "";
let jsdocParserFilePath = "";
let generateBtn = null;
let webViewPanel = null;
let serverIsRunning = false;

const tnames = {
    "all": "all types",
    "bin": "Boolean",
    "dso": "app object",
    "gvo": "game object",
    "swo": "smartwatch object",
    "jso": "JavaScript object",
    "fnc": "Function",
    "lst": "List",
    "num": "Number",
    "obj": "Object",
    "str": "String",
    "?": "unknown",
    "ui": "ui object",

    "lst_obj": "of objects",
    "lst_num": "of numbers",
    "num_byt": "bytes",
    "num_col": "hexadecimal 0xrrggbb",
    "num_dat": "datetime in milliseconds (from JS Date object)",
    "num_deg": "angle in degrees (0..360)",
    "num_dhx": "0-255",
    "num_fac": "factor",
    "num_flt": "float",
    "num_fps": "frames per second",
    "num_frc": "fraction (0..1)",
    "num_gbt": "gigabytes",
    "num_hrz": "hertz",
    "num_int": "integer",
    "num_met": "meters",
    "num_mls": "milliseconds",
    "num_mtu": "maximum transmission unit",
    "num_prc": "percent",
    "num_pxl": "pixel",
    "num_rad": "angle in radient (0..2*π)",
    "num_sec": "seconds",
    "str_acc": "account Email",
    "str_b64": "base64 encoded",
    "str_col": "<br>&nbsp;&nbsp;hexadecimal: “#rrggbb”, “#aarrggbb”<br>&nbsp;&nbsp;colourName: “red”, “green”, ...",
    "str_com": "comma “,” separated",
    "str_eml": "comma separated email addresses or names",
    "str_flt": "float",
    "str_fmt": "format",
    "str_htm": "html code",
    "str_hex": "hexadecimal “00”..“FF”",
    "str_int": "integer",
    "str_jsc": "javascript code",
    "str_jsn": "JSON object",
    "str_lst": "separated",
    "str_mim": "mimetype",
    "str_mod": "mode",
    "str_num": "number",
    "str_oid": "object id “#id”",
    "str_ort": "“Default”, “Portrait”, “Landscape”",
    "str_pip": "pipe “|” separated",
    "str_ptc": "file path or content:// uri",
    "str_pth": "path to file or folder ( “/absolute/...” or “relative/...” )",
    "str_ptf": "path to file ( “/absolute/...” or “relative/...” )",
    "str_ptd": "path to folder ( “/absolute/...” or “relative/...” )",
    "str_pfa": "“/absolute/...” path to a file",
    "str_pfr": "“relative/...” path to a file",
    "str_pda": "“/absolute/...” path to a folder",
    "str_pdr": "“relative/...” path to a folder",
    "str_pxl": "integer in pixels",
    "str_smc": "semicolon “;” separated",
    "str_sql": "sql code",
    "str_sty": "style",
    "str_uri": "URI encoded",
    "str_url": "url path"
};

function activate( context ) {

    const cw = vscode.workspace.workspaceFolders[0];

    if(!cw || !cw.name) return;

    folderPath = cw.uri.fsPath;
    generateJSFilePath = path.join(folderPath, "files", "generate.js");
    jsdocParserFilePath = path.join(folderPath, "files", "jsdoc-parser.js");

    if( !fs.existsSync(generateJSFilePath) ) return;
    if( !fs.existsSync(jsdocParserFilePath) ) return;

    generateBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    generateBtn.command = "droidscript-docs.generateDocs";
    generateBtn.text = "$(tools) Generate Docs";
    generateBtn.tooltip = "DroidScript Docs: Generate";
    generateBtn.show();

    vscode.workspace.onDidChangeTextDocument( event => {
        // Handle the event, for example, update the status bar icon
        generateBtn.text = "$(tools) Generate Docs";
        generateBtn.tooltip = "DroidScript Docs: Generate";
    });

	context.subscriptions.push(vscode.commands.registerCommand("droidscript-docs.generateDocs", generateDocs));

    vscode.languages.registerCompletionItemProvider('javascript', {
        provideCompletionItems
    });
}

// This method is called when your extension is deactivated
function deactivate() {
    generateBtn.dispose();
    webViewPanel.dispose();
}

function generateDocs() {
    
    generateBtn.text = "$(sync) Generating docs...";
    generateBtn.tooltip = "Generating docs...";

    // Execute the Docs/files/jsdoc-parser.js file
    exec(`node ${jsdocParserFilePath}`, (error, stdout, stderr) => {
        if( error ) return console.log(`Error: ${error.message}`);

        // Execute the Docs/files/generate.js file
        exec(`node ${generateJSFilePath}`, (error, stdout, stderr) => {
            if( error ) return console.error(`Error: ${error.message}`);

            generateBtn.text = "$(check) Generate successfull";
            generateBtn.tooltip = "Generate successfull";

            // console.log(`stdout: ${stdout}`);
            // console.error(`stderr: ${stderr}`);

            openWithLiveServer();
        });
    });
}

async function openWithLiveServer() {
    if( serverIsRunning ) return;
    const fileUri = vscode.Uri.file( path.join(folderPath, "out", "docs", "Docs.htm") );
    const document = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('extension.liveServer.goOnline');
    serverIsRunning = true;
    // openDocs();
}


function provideCompletionItems(doc, pos, token, context) {
    const ln = pos.line;
    const cd = doc.lineAt(ln).text;

    if(!cd.includes("@param") && !cd.includes("@return")) return;
    
    const completionItems = Object.keys(tnames).map(m => {
        return new vscode.CompletionItem(m, vscode.CompletionItemKind.Property);
    });

    // Customize your completion items
    completionItems.forEach(item => {
        let a = item.label;
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
