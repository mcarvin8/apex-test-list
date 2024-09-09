# summary

List

# description

Lists tests in a package.xml file or from a directory.

# flags.directory.summary

Directory name. Defaults to the current working directory.

# flags.directory.description

Usually, if you run this command at the root of your Salesforce DX project, it means that the directory points to the original "force-app" folder (even if you have renamed it to something else). If you wish to limit the usage to a specific module, specify the folder with this flag.

# flags.format.summary

Format of the output.

# flags.format.description

By default, the format being returned is a list in the format that can be merged with the test flags of the Salesforce CLI deploy and validate commands. Available formats are `sf` (default) and `csv`.

# flags.manifest.summary

Manifest XML file.

# flags.manifest.description

When you specify a manifest file, the plugin will not search directories for all classes with annotations, but instead will read the manifest file and search for those classes within the specified directory.

# examples

- <%= config.bin %> <%= command.id %> --format csv
- <%= config.bin %> <%= command.id %> --format sf --directory force-app
- <%= config.bin %> <%= command.id %> --format sf --manifest package.xml