fx_version 'cerulean'
game 'gta5'

name 'whip_dealership'
author 'Whippy'
description 'Example whip satellite — a vehicle dealership'
version '1.1.0'

-- The reference resource for building on whip: everything it touches is a public whip_core export.

-- Satellite helper: Whip.register runs what we declare to whip_core when it is ready, and again on restart.
shared_script '@whip_core/lib/satellite.lua'
shared_script 'config.lua'

client_script 'client/main.lua'
server_script 'server/main.lua'

ui_page 'html/index.html'

-- Only this resource's page may call its NUI callbacks (dealershipBuy spends the player's money).
nui_callback_strict_mode 'true'

-- Every asset listed by hand: a file missing from this list 404s in the browser and the panel comes up blank.
files {
    'html/index.html',
    'html/css/dealership.css',
    'html/js/dealership.js',
}

dependency 'whip_core'

lua54 'yes'
