// @ts-types="npm:@types/yargs@17.0.33"
import yargs, { type Options } from 'yargs';
// @ts-types="npm:@types/ws@8.5.14"
import { WebSocketServer } from 'ws';

import { existsSync } from 'node:fs';
import { execSync } from "node:child_process";
import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs';

interface Option extends Options {
    name: string
}

type TaskHandler = (args: Record<string, unknown>) => number;

type Task = {
    name: string,
    description: string,
    handler: TaskHandler
};

/**
 * Contains all the methods for the build tool; includes methods for path
 * manipulation, task generation, and a wrapper for `npm:yargs`.
 */
export class Builder {
    protected shouldVerbose: boolean;
    protected tasks: Task[];
    protected args: Option[];
    protected taskStack: string[];
    protected allowExternalCommands: boolean;

    constructor() {
        this.allowExternalCommands = false;
        this.shouldVerbose = false;
        this.tasks = [];
        this.taskStack = [];
        this.args = [];
    }

    /**
     * Write an informational message to stdout
     * @param data the message to write
     */
    info(...data: unknown[]): void {
        if(this.shouldVerbose) {
            console.log(`\x1b[1mINFO\x1b[0m(\x1b[33m${this.taskStack.at(-1) ?? '*'}\x1b[0m):`, ...data);
        }
    }

    /**
     * Write an optional message to stdout
     * @param data the message to write
     */
    verbose(...data: unknown[]): void {
        if(this.shouldVerbose) {
            console.log(`\x1b[1;92mVERBOSE\x1b[0m(\x1b[33m${this.taskStack.at(-1) ?? '*'}\x1b[0m):`, ...data);
        }
    }

    /**
     * Write a warning message to stdout
     * @param data the message to write
     */
    warn(...data: unknown[]): void {
        console.log(`\x1b[1;93mVERBOSE\x1b[0m(\x1b[33m${this.taskStack.at(-1) ?? '*'}\x1b[0m):`, ...data);
    }

    /**
     * Write an error message to stderr
     * @param data the message to write
     */
    error(...data: unknown[]): void {
        console.error(`\x1b[1;91mERROR\x1b[0m(\x1b[33m${this.taskStack.at(-1) ?? '*'}\x1b[0m):`, ...data);
    }

    /**
     * Write a fatal message to stderr, before exiting
     * @param data the message to write
     */
    fatal(...data: unknown[]): never {
        console.error(`\x1b[1;95mFATAL\x1b[0m(\x1b[33m${this.taskStack.at(-1) ?? '*'}\x1b[0m):`, ...data);
        if(this.taskStack.length > 0 && this.shouldVerbose) {
            this.taskStack.reverse();
            console.error(` Task stack:`);
            for(let i=0;i<this.taskStack.length;i++) {
                console.error(`  - \x1b[${i == 0 ? '91' : '37'}m${this.taskStack[i]}\x1b[0m`);
            }
        }
        process.exit(1);
    }

    /**
     * Add a task to the list of runnable lists
     * @param name The name of the task
     * @param desc The description of the task
     * @param c The task handler that's run when the task is run
     */
    addTask(name: string, desc: string, c: TaskHandler): void {
        this.tasks.push({ name, description: desc, handler: c })
    }

    /**
     * Add an argument for the user to select
     * @argument a an argument; this will be copied
     */
    addArgument(a: Option): void {
        this.args.push(Object.assign({}, a));
    }

    /**
     * Run a task
     * @param task the task name
     * @param args the arguments passed to the task
     * @returns the return value from the task
     */
    runTask(task: string, args: Record<string, unknown>): number {
        const t = this.tasks.find((v)=>v.name==task);

        if(t == undefined) {
            this.fatal(`Failed to run task "${task}"`);
        }

        this.verbose(`Starting task \x1b[33m${t.name}\x1b[0m...`);
        this.taskStack.push(t.name);
        const resp = t.handler(args);
        this.taskStack.pop();
        if(resp < 0) this.error(`Failed task "${t.name}"`);
        return resp;
    }

    /**
     * Begin the builder, running the task specified in args
     * @param args the arguments to parse
     */
    begin(args: string[]): void {
        let t = yargs(args)
            .strictCommands()
            .demandCommand()
            .option('v', { alias: 'verbose', type: 'boolean', default: false })
        ;
        
        for(let i=0;i<this.tasks.length;i++) {
            t = t.command(
                this.tasks[i].name,
                this.tasks[i].description,
                ()=>{},
                (args) => {
                    if(args.v) this.shouldVerbose = true;
                    this.runTask(this.tasks[i].name, args);
                }
            );
        }

        for(let i=0;i<this.args.length;i++) {
            t = t.option(this.args[i].name, this.args[i]);
        }

        t.parseSync();
        
        // TODO: add a post-run something or other
    }

    assert(cond: boolean, ...error: unknown[]): void | never {
        if(!cond) {
            this.fatal(...error);
        }
    }

    /**
     * Copy a file/directory to another location
     * @param source the source file/directory
     * @param dest the destination
     */
    copy(source: string, dest: string): boolean {
        if(!existsSync(source)) return false;
        try {
            fs.copyFileSync(source, dest);
        } catch(e) {
            this.warn(e);
            return false;
        }

        return true;
    }

    /**
     * Remove a file or directory recursively if it exists, otherwise does nothing
     * @param path the path to remove
     */
    remove(path: string): void {
        if(existsSync(path)) {
            this.verbose(`Removing \x1b[32m${path}\x1b[0m`);
            if(fs.statSync(path).isDirectory())
                fs.rmdirSync(path, { recursive: true });
            else
                fs.rmSync(path);
        }
    }

    /**
     * Create a directory if it doesn't exist, otherwise it does nothing
     * @param path the path to create
     * @param shouldCreate whether to create the path or not
     */
    createDirectory(path: string, shouldCreate = true): void {
        if(!shouldCreate) return;

        if(!existsSync(path)) {
            this.verbose(`Creating \x1b[32m${path}\x1b[0m`);
            fs.mkdirSync(path, { recursive: true });
        }
    }

    /**
     * Run a command, blocking tasks until it finishes
     * @param command the command to run 
     * @param continueIfFailed whether to continue if the command fails
     */
    runCommand(command: string, continueIfFailed = false): boolean | never {
        this.verbose(`${command}`);
        
        try {
            execSync(command, { stdio: 'inherit', encoding: 'ascii' });
            return true;
        } catch {
            if(!continueIfFailed) {
                this.fatal(`Failed command \x1b[32m${command}\x1b[0m`);
            }
            return false;
        }
    }

    /**
     * Run a command if the source is newer than the destination file
     * @param command the command to run
     * @param source the source file to check
     * @param destination the destination file to check
     */
    compile(command: string, source: string, destination: string): void {
        if(!existsSync(source)) {
            this.fatal(`"${source}" doesn't exist, despite being used in \x1b[94mcompile\x1b[0m()`);
        }

        
        if(!existsSync(destination)) {
            this.runCommand(command);
            return;
        }

        const sourceStats = fs.statSync(source);
        const destStats = fs.statSync(destination);
        
        if(!sourceStats.mtime || (sourceStats.mtime?.getTime() ?? 0) > (destStats.mtime?.getTime() ?? 0)) {
            this.runCommand(command);
        }
    }

    /**
     * Scan a directory recursively, returning the files in a flat array
     * @param path the path to scan
     * @param matches only files that match this RegExp will be added
     * @param ignores only files that don't match this RegExp will be added
     * @returns an array of files, relative to the path sent
     */
    scanDir(path: string, matches?: RegExp, ignores?: RegExp): string[] {
        let fnames: string[] = [];
    
        const files = fs.readdirSync(path, { withFileTypes: true });
        for(const file of files) {
            if(file.isDirectory()) {
                fnames = fnames.concat(this.scanDir(this.joinPath(path, file.name), matches, ignores));
            } else {
                if((ignores && file.name.match(ignores)) || (matches && !file.name.match(matches))) {
                    continue;
                }
                
                fnames.push(this.joinPath(path, file.name));
            }
        }

        return fnames;
    }

    /**
     * Join a collection of strings to form a single path
     * @param paths parts of a path
     */
    joinPath(...paths: string[]): string {
        return path.join(...paths);
    }

    /**
     * Replace the extension on file `f` with `ext`
     * @param f the file with the extension to replace
     * @param ext the extension to replace the previous extension
     */
    extension(f: string, ext: string): string {
        return f.replace(path.extname(f), ext);
    }

    /**
     * Fetch only the file in a path
     * @param f a path with a file
     */
    justFile(f: string): string {
        return path.basename(f);
    }

    /**
     * Allow `Builder.exCall` to run
     */
    allowExternal(): void {
        this.allowExternalCommands = true;
    }

    /**
     * Start an external server for commands to run with `Builder.exCall()`
     * @param port the port to start the server on
     */
    startExServer(port: number = 8086): void {
        const server = new WebSocketServer({
            port
        });

        server.on('connection', (s) => {
            s.on('message', (v) => {
                const msg = v.toString();

                if(msg.startsWith('r::')) {
                    s.send((this.runCommand(msg.slice(3), true) ?? true) ? 0 : 1);
                }
            });
        });

        server.on('listening', () => {
            this.verbose(`Server started on port :${port}`);
        }); 
    }

    /**
     * Run a command from the ip and port, only if `Builder.allowExternal()`
     * is called. Otherwise, run on the local machine
     * @param s the command to run
     * @param ip the ip (default is 127.0.0.1) of the external server
     * @param port the port (default is 8086) of the external server
     */
    exCall(s: string, ip?: string, port = 8086): void | never {
        if(!this.allowExternalCommands) {
            this.runCommand(s);
            return;
        }
        try {
            const ws = new WebSocket(`ws://${ip ?? '127.0.0.1'}:${port}`);
            
            ws.addEventListener('open', () => {
                this.verbose(`excall ${s}`);
                ws.send(`r::${s}`);
                ws.close();
            });
        
            ws.addEventListener('message', (ev) => {
                if(ev.data != 0) {
                    this.error(`Failed to run command \x1b[32m"${s}"\x1b[0m`);
                    console.log(`\x1b[90m[\x1b[31m%\x1b[90m]\x1b[0m Failure`);
                }
            })
        
            ws.addEventListener('error', (ev) => {
                this.fatal((ev as ErrorEvent).message);
            });
        } catch (e) {
            console.error(`\x1b[90m[\x1b[31m%\x1b[90m]\x1b[0m Failed to send`);
            console.error(e);
        }
    }
}