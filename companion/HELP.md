## Blackmagic Videohub Panel

The Blackmagic Videohub Panels can be utilised in a limited capacity.

This has only been confirmed to work with the discontinued Smart Control Panel. Other models may work, but have not been tested.  
This should also be usable for custom videohub client implementations to control Companion.

Note: Upon connection, Companion will update the configuration of the panel to set a basic keymap. This takes a few seconds to apply, the panels are not very fast.

Due to firmware/protocol limitations, the buttons will no light at any point.

### Setting up a panel

Use the videohub panel configuration tool, to tell it to connect to the ip address of your Companion

### Multiple pages

By default, each panel is mapped to a single page in Companion. This base page follows the usual page change logic in Companion

In the _Settings_ of each connected panel, you can specify the _Page Count_. This turns the rightmost buttons into page change buttons, which apply as an offset from the assigned page of the panel.
