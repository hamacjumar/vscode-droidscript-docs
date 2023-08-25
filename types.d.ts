import pkg from "./package.json";

declare global {
    interface Obj<T> {
        [x:string]: T;
    }

    type DSConfig = {
        scopes: Obj<string>;
        langs: Obj<string>;
        regHide: string;
        regControl: string;
        tname: Obj<string>;
        tdesc: Obj<string>
    }

    type PkgCmds = typeof pkg.contributes.commands;
    type CmdMap = {[x in PkgCmds[number]["command"]]: PkgCmds[number]["title"]}
}