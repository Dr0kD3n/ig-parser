const ms = parseInt(process.argv[2]) || 10000;
setTimeout(() => {
  process.exit(0);
}, ms);
