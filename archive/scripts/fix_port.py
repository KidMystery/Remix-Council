with open('server.ts', 'r') as f:
    content = f.read()

content = content.replace("const PORT = process.env.PORT || 3000;", "const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;")

with open('server.ts', 'w') as f:
    f.write(content)
