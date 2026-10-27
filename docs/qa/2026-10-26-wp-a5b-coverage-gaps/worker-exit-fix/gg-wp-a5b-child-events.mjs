process.on('disconnect', () => process.exit(0));
process.stderr.write('child ready\n');
process.send({ ready: true });
