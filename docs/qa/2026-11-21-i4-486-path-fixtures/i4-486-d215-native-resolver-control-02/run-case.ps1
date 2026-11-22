$testArguments = @('--filter','@graphgoblin/infrastructure','exec','vitest','run','src/fs/fs.test.ts','-t','uses real temp paths','--reporter=verbose')
& pnpm.cmd @testArguments
exit $LASTEXITCODE
