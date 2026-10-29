Fix parseTimeout: undefined means the 5000ms default; zero is valid; noninteger, negative and nonnumeric values return null. Accept numeric strings.
