// Starter files for each room language.
const TEMPLATES = {
  javascript: {
    label: 'JavaScript',
    files: [
      {
        name: 'main.js',
        content: `// Welcome to Cody Vibes!  Press Run (or Ctrl/Cmd + Enter)
const { greet } = require('./utils');

console.log(greet('Cody Vibes'));

const nums = [5, 3, 8, 1, 9, 2];
console.log('Sorted:', [...nums].sort((a, b) => a - b));
console.log('Sum:', nums.reduce((a, b) => a + b, 0));
`,
      },
      {
        name: 'utils.js',
        content: `function greet(name) {
  return \`Hello from \${name}! Let's code together.\`;
}

module.exports = { greet };
`,
      },
    ],
  },
  python: {
    label: 'Python',
    files: [
      {
        name: 'main.py',
        content: `# Welcome to Cody Vibes!  Press Run (or Ctrl/Cmd + Enter)
from helpers import fib

name = input("What's your name? ") or "friend"
print(f"Hey {name}, let's vibe and code!")

print("First 10 Fibonacci numbers:", [fib(i) for i in range(10)])
`,
      },
      {
        name: 'helpers.py',
        content: `def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
`,
      },
    ],
  },
  cpp: {
    label: 'C++',
    files: [
      {
        name: 'main.cpp',
        content: `// Welcome to Cody Vibes!  Press Run (or Ctrl/Cmd + Enter)
#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    vector<int> v = {5, 3, 8, 1, 9, 2};
    sort(v.begin(), v.end());
    cout << "Hello from Cody Vibes (C++)!" << endl;
    cout << "Sorted: ";
    for (int x : v) cout << x << " ";
    cout << endl;
    return 0;
}
`,
      },
    ],
  },
  c: {
    label: 'C',
    files: [
      {
        name: 'main.c',
        content: `// Welcome to Cody Vibes!  Press Run (or Ctrl/Cmd + Enter)
#include <stdio.h>

int main(void) {
    printf("Hello from Cody Vibes (C)!\\n");
    for (int i = 1; i <= 5; i++) printf("%d squared = %d\\n", i, i * i);
    return 0;
}
`,
      },
    ],
  },
  java: {
    label: 'Java',
    files: [
      {
        name: 'Main.java',
        content: `// Welcome to Cody Vibes!  Press Run (or Ctrl/Cmd + Enter)
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello from Cody Vibes (Java)!");
        for (int i = 1; i <= 5; i++) System.out.println(i + " x 7 = " + (i * 7));
    }
}
`,
      },
    ],
  },
  ruby: {
    label: 'Ruby',
    files: [
      {
        name: 'main.rb',
        content: `# Welcome to Cody Vibes!  Press Run (or Ctrl/Cmd + Enter)
puts "Hello from Cody Vibes (Ruby)!"
[3, 1, 2].sort.each { |n| puts "Number #{n}" }
`,
      },
    ],
  },
  web: {
    label: 'Web (HTML/CSS/JS)',
    files: [
      {
        name: 'index.html',
        content: `<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <h1>Hello, Cody Vibes!</h1>
    <p>Edit index.html, style.css and script.js together. Open the Preview tab to see changes live.</p>
    <button id="btn">Click me</button>
    <p id="count">Clicked 0 times</p>
    <script src="script.js"></script>
  </body>
</html>
`,
      },
      {
        name: 'style.css',
        content: `body {
  font-family: system-ui, sans-serif;
  background: linear-gradient(135deg, #1e1b4b, #581c87);
  color: white;
  padding: 2rem;
}
button {
  background: #f472b6;
  border: none;
  color: white;
  padding: 0.6rem 1.2rem;
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;
}
`,
      },
      {
        name: 'script.js',
        content: `let count = 0;
document.getElementById('btn').addEventListener('click', () => {
  count++;
  document.getElementById('count').textContent = \`Clicked \${count} times\`;
});
`,
      },
    ],
  },
};

module.exports = TEMPLATES;
