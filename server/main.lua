-- Dealership server: the showroom list is assembled, and money is exchanged for a vehicle (never half-happening).

local core = exports.whip_core

--- Simon's position, for the proximity guard on every event below. Declared once so the
--- guard and the ped can never drift apart.
local function simonAt()
    local c = Config.Salesman.coords
    return c.x, c.y, c.z
end

-- (The class → vehicle type table that lived here moved into whip_core, 09-23: CreateOwnedVehicle
-- now works the type out from the vehicle catalog itself, for every seller.)

-- ============================================
-- The showroom list
-- ============================================

--- Build what the dealership has for sale.
--- Driven by whip_core's vehicle catalog, filtered to models that have a picture, so there is no second list.
local function buildCatalogue()
    local catalog = core:GetVehicleCatalog() or {}
    local out = {}

    for model, row in pairs(catalog) do
        local class = row.class

        -- `hasImage` is a boolean and `image` the picture's URL, straight from whip_core. `inGame == false` is a
        -- car this game does not have: whip_core refuses to make one, so it is left out.
        if row.hasImage and class and Config.SellableClasses[class] and row.inGame ~= false then
            out[#out + 1] = {
                model = model,
                name  = row.displayName or model:upper(),
                class = class,
                image = row.image,
                price = Config.PriceFor(model, class),
            }
        end
    end

    table.sort(out, function(a, b)
        if a.price ~= b.price then return a.price < b.price end
        return a.name < b.name
    end)

    return out
end

--- The cash a payment can take: loose notes and what their wallets hold (whip_core's GetSpendableCash, as the charge
--- counts it), or the loose notes alone on a whip_core without it.
local function spendableCash(source)
    local ok, n = pcall(function() return core:GetSpendableCash(source) end)
    if ok and tonumber(n) then return tonumber(n) end
    return tonumber(core:GetPlayerCash(source)) or 0
end

local function onCatalogue(source, player)
    local vehicles = buildCatalogue()

    -- The accounts travel with the catalogue so the payment selector needs no second round trip. Only accounts they
    -- can pay from are listed: the bank's own answer (CanUseBankAccount) decides, not a copy of its roles.
    local accounts = {}
    for _, acct in ipairs(core:GetCharacterBankAccounts(player.charId) or {}) do
        -- The account first, then the person — `{ charId = n }` for a character (whip's person rule).
        if core:CanUseBankAccount(acct.accountId, { charId = player.charId }, 'withdraw') then
            accounts[#accounts + 1] = {
                accountId     = acct.accountId,
                label         = acct.label,
                accountNumber = acct.accountNumber,
                balance       = acct.balance,
            }
        end
    end

    return {
        vehicles = vehicles,
        accounts = accounts,
        -- Loose notes and wallet cash: what the Cash button can really pay with
        cash     = spendableCash(source),
        -- (Each vehicle carries its own `image` URL now, from whip_core's catalog — the pictures
        -- live there, and this resource no longer spells out where.)
    }
end

-- ============================================
-- Buying
-- ============================================

--- Take payment: a receipt, or false and a reason the player can read.
--- Uses whip_core's ChargePlayer, which checks the player's real withdraw permission; RefundPlayer puts money back
--- where it came from. Inside this SecureEvent the payment lands in the same transaction as the car's row.
---@return table|false receipt, string|nil err
local function takePayment(source, method, accountId, price, label)
    return core:ChargePlayer(source, price, {
        method    = method == 'bank' and 'bank' or 'cash',
        accountId = method == 'bank' and accountId ~= 0 and accountId or nil,
        reason    = 'Vehicle: ' .. label,
    })
end

local function onBuy(source, _, model, payment, accountId)
    -- A REFUSAL IS `return false, 'why'`. whip shows the player the why and records the refusal in
    -- the event log, the same as its own checks. The result event only tells the open menu, so it
    -- can stop showing "buying" and say what happened in its own words.
    local function fail(msg)
        TriggerClientEvent('whip_dealership:client:purchaseResult', source, false, msg, model)
        return false, msg
    end

    -- Re-resolve everything from the server's own data. The client sent a model name and
    -- nothing else that matters — the price, the vehicle's existence and whether the dealership
    -- even sells it are all decided here.
    local catalog = core:GetVehicleCatalog() or {}
    local row = catalog[model]
    if not row then return fail('That car is not for sale here') end

    if not row.hasImage or not row.class or not Config.SellableClasses[row.class] then
        return fail('That car is not for sale here')
    end
    -- Before any money moves: a car this game does not have (whip_core would refuse it and refund).
    if row.inGame == false then return fail('That car is not in this game') end

    local label = row.displayName or model:upper()
    local price = Config.PriceFor(model, row.class)

    -- Check for room for the key BEFORE any money moves, so the ordinary "pockets full" case
    -- never reaches a refund at all. (A key failure after payment is still unwound below.)
    if not core:CanFitItem(source, 'vehicle_key', 1) then
        return fail('No room for the key — free a slot first')
    end
    -- And whether the car can come out for them at all (a Director builder in Isolate world cannot),
    -- before any money moves for the same reason.
    local canOut, outWhy = core:CanBringOutVehicleFor(source)
    if not canOut then return fail(outWhy or 'The car cannot be brought out for you now') end

    local receipt, payErr = takePayment(source, payment, accountId, price, label)
    if not receipt then return fail(payErr or 'Payment failed') end

    -- From here on the money is gone, so every failure has to put it back before returning. One call creates the
    -- car, brings it out and hands over the key, and removes the car itself on failure: only the payment is undone here.
    local vehicleId, createErr, saved = core:CreateOwnedVehicle(source, {
        model = model,
        stats = { fuel = 100.0 },   -- a full tank (with whip_fuel; without it, nothing reads it)
    }, {
        giveKey = true,
        spawnAt = Config.Delivery,
    })

    -- Made and paid for, but not loaded yet (a database fault): the car is theirs and comes to their garage, so the
    -- payment that landed with it stands (whip_core told the buyer). Refunding here gave the money back for a car they
    -- then got anyway (audit 20, VEH-5).
    if not vehicleId and saved then
        print(('[whip_dealership] %s bought a %s for $%d: saved, waiting to be read back (%s)')
            :format(GetPlayerName(source), tostring(model), price, tostring(createErr)))
        TriggerClientEvent('whip_dealership:client:purchaseResult', source, true,
            ('%s is yours — it will be waiting in your garage'):format(label), model)
        return
    end

    if not vehicleId then
        -- Money taken for a car that was never handed over must never disappear silently.
        local refunded, refundErr = core:RefundPlayer(receipt)
        print(('[whip_dealership] %s $%d to %s — the sale did not complete: %s%s')
            :format(refunded and 'refunded' or 'CRITICAL: COULD NOT REFUND', price, GetPlayerName(source),
                tostring(createErr), refunded and '' or (' (' .. tostring(refundErr) .. ')')))
        if not refunded then
            return fail('Something went wrong with the paperwork, and the refund failed — tell an admin')
        end
        -- The reason goes to the buyer: the common one is now "Something is already parked in that
        -- spot" (the last sale still on the forecourt), which they can do something about.
        return fail(('The sale did not complete (%s). You have not been charged.'):format(tostring(createErr)))
    end

    -- The second return is the ERROR, always. The plate is a field of the vehicle, and asking for
    -- it says so.
    local plate = core:GetVehicle(vehicleId).plate

    TriggerClientEvent('whip_dealership:client:purchaseResult', source, true,
        ('%s is yours — plate %s'):format(label, tostring(plate)), model)

    print(('[whip_dealership] %s bought %s (%s) for $%d via %s')
        :format(GetPlayerName(source), label, tostring(plate), price, payment))
end

-- ============================================
-- Manage Keys
-- ============================================
--
-- Simon's second option (client: myCars). Each call names its car with a 'vehicle' param, which refuses a car that is
-- not this player's before the handler runs ("That is not your vehicle"), and hands over a snapshot of it.

--- The cars this player owns: name, plate and picture, sorted by name.
local function onMyVehicles(source)
    local out = {}
    for _, v in ipairs(core:GetVehiclesOf(source) or {}) do
        out[#out + 1] = {
            vehicleId = v.vehicleId,
            name      = v.displayName or tostring(v.model or 'Vehicle'):upper(),
            plate     = tostring(v.plate or ''),
            -- The catalog's picture (nil: none), the one the garage and the showroom show.
            image     = v.model and core:GetVehicleImage(v.model) or nil,
        }
    end
    table.sort(out, function(a, b)
        if a.name ~= b.name then return a.name < b.name end
        return a.plate < b.plate
    end)
    return out
end

--- How many keys of it there are now, wherever they are: only the number.
local function onKeyCount(_, _, vehicle)
    return core:CountVehicleKeys(vehicle.vehicleId)
end

--- A new key into their pockets, even when they hold one already (a spare for a friend).
local function onMakeKey(source, _, vehicle)
    if not core:CanFitItem(source, 'vehicle_key', 1) then
        return false, 'No room for the key — free a slot first'
    end
    local ok, why = core:GiveVehicleKey(source, vehicle.vehicleId, { spare = true })
    if not ok then return false, why or 'No key was made' end
    print(('[whip_dealership] %s had a key made for %s'):format(GetPlayerName(source), tostring(vehicle.plate)))
    return true
end

--- New locks: every key made before stops fitting, wherever it is. Keys made after work.
local function onDisableKeys(source, _, vehicle)
    local ok, why = core:ChangeVehicleLocks(vehicle.vehicleId)
    if not ok then return false, why or 'The locks were not changed' end
    print(('[whip_dealership] %s changed the locks of %s: every older key stopped')
        :format(GetPlayerName(source), tostring(vehicle.plate)))
    return true
end

-- ============================================
-- Simon and the blip
-- ============================================
--
-- Simon is one of whip's NPCs (SpawnNpc): made once by the server, the same Simon in every game, kept standing at his
-- spot doing his idle, and gone when this resource stops. Invincible, frozen and deaf to gunfire: a salesman who
-- leaves mid-sentence is not a salesman. He is made once a character has loaded, as whip asks (on Enhanced an NPC
-- made on an empty server can lose its network id), and made again if whip_core restarts (its NPCs go with it).

local IDLE = { dict = 'anim@amb@business@bgen@bgen_no_work@', clip = 'idle_a' }
local simonNpc = nil

--- Is he there? Asked among this resource's own NPCs (GetNpcs): an npcId starts again after whip_core restarts, so
--- the same number can be someone else's NPC.
local function simonIsThere()
    if not simonNpc then return false end
    for _, n in ipairs(core:GetNpcs() or {}) do
        if n.npcId == simonNpc then return true end
    end
    return false
end

local function spawnSimon()
    if simonIsThere() then return end   -- (another character loading)
    local npcId, why = core:SpawnNpc({
        model      = Config.Salesman.model,
        coords     = Config.Salesman.coords,
        behaviour  = 'stand',
        conditions = { invincible = true, canMove = false, reacts = false, flees = false },
    }, { fightBack = false })
    if not npcId then
        print(('[whip_dealership] Simon could not be made (is %s a ped model?): %s')
            :format(tostring(Config.Salesman.model), tostring(why)))
        return
    end
    simonNpc = npcId
    core:SetNpcState(npcId, { anim = IDLE })
end

--- Someone is playing: Simon may be made now (once; spawnSimon says if he is there already).
local function anyonePlaying()
    for _, src in ipairs(GetPlayers()) do
        if core:GetCharId(tonumber(src) --[[@as number]]) then return true end   -- a character loaded (nil at character select)
    end
    return false
end

AddEventHandler('whip_core:player:loaded', function() spawnSimon() end)

--- The lot on everyone's map. whip keeps it while this resource runs; the same id again changes it in place.
local function showBlip()
    local b = Config.Blip
    if not b or not b.show then return end
    local c = Config.Salesman.coords
    local ok, why = core:ShowBlip('everyone', 'lot', {
        coords = vector3(c.x, c.y, c.z), label = b.label, sprite = b.sprite, color = b.color,
        scale = b.scale, shortRange = true,
    })
    if not ok then print('[whip_dealership] no blip: ' .. tostring(why)) end
end

-- ============================================
-- Registration
-- ============================================

--- Everything this resource declares to whip_core, in one idempotent function.
--- Called through Whip.register, not at file scope: whip_core keeps its registry in memory, so Whip.register re-runs
--- this whenever core restarts (re-declaring is safe). Every name starts with this resource's name, so none collide.
local function RegisterWithWhip()
    -- What Simon charges, for whoever works out what a car is worth (the /whip Banks page).
    local prices = {}
    for _, vehicle in ipairs(buildCatalogue()) do prices[vehicle.model] = vehicle.price end
    core:SetVehiclePrices(prices)

    core:SecureCallback('whip_dealership:catalogue', {
        rateLimit = 1000,
        -- message = false: the menu shows the reason it was handed back (client openMenu), so
        -- whip's own "Too far away" toast would say it twice.
        near      = { at = simonAt, range = Config.Salesman.useRange, message = false },
    }, onCatalogue)

    core:SecureEvent('whip_dealership:server:buy', {
        -- burst = 2: a retry straight after a refusal ("Not enough cash" → switch to Bank → Buy)
        -- goes through instead of being eaten by the cooldown.
        rateLimit = 3000, burst = 2,
        -- The framework's own guard requires the player to be standing at Simon, before the handler runs.
        -- message = false: onReject below hands the reason to the menu.
        near   = { at = simonAt, range = Config.Salesman.useRange, message = false },
        -- A REFUSAL BEFORE onBuy RUNS ANSWERS THE MENU TOO (audit 4, DX-3): the cooldown, `near`, a
        -- bad param. The menu waits on purchaseResult, and it stayed on "Doing the paperwork…"
        -- until it was closed.
        onReject = function(src, why)
            TriggerClientEvent('whip_dealership:client:purchaseResult', src, false,
                why == 'Rate limited' and 'One moment — try that again' or tostring(why))
        end,
        params = {
            {'model',     'key',  60},
            {'payment',   'enum', { 'cash', 'bank' }, 'cash'},
            {'accountId', 'id',   0},   -- 0 = none (cash); the bank's own permission check decides the rest
        },
    }, onBuy)

    -- Manage Keys. At Simon, like the rest; message = false because the prompt says the reason itself.
    local atSimon = { at = simonAt, range = Config.Salesman.useRange, message = false }
    local car = { {'vehicle', 'vehicle'} }   -- one of THEIR cars (whip refuses anyone else's)
    core:SecureCallback('whip_dealership:myVehicles', { rateLimit = 1000, burst = 2, near = atSimon }, onMyVehicles)
    -- Asked again after every key made or locks changed (the page fills again), so a burst is allowed.
    core:SecureCallback('whip_dealership:keyCount',
        { rateLimit = 500, burst = 4, near = atSimon, params = car }, onKeyCount)
    core:SecureCallback('whip_dealership:makeKey',
        { rateLimit = 1000, burst = 2, near = atSimon, params = car }, onMakeKey)
    core:SecureCallback('whip_dealership:disableKeys',
        { rateLimit = 2000, near = atSimon, params = car }, onDisableKeys)

    showBlip()
    if anyonePlaying() then spawnSimon() end   -- else at the first character to load
end

Whip.register(RegisterWithWhip)
