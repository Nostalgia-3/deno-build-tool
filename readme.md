# Deno Build Tool

A build tool for Deno scripts meant to build projects. You should probably use `make` or some other build tool instead.

## Usage

An example:

```ts
import { Builder } from 'jsr:@nostalgia3/build-tool';

const build = new Builder();

build.addArgument({
    name: 'name',
    description: 'Your name',
    requiresArg: true
});

build.addTask('hello', 'Say hello', (args) => {
    console.log(`Hello, ${args.name}!`);
    
    return 0;
});

build.begin(Deno.args);
```