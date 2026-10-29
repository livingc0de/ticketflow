Fix isEnabled for environment flags. True means boolean true, numeric 1, or string true/1 (case-insensitive, trim whitespace). Everything else is false, especially false and 0 strings.
