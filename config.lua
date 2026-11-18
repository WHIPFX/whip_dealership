-- Dealership settings. A shared_script, so the client positions Simon and the server checks the player is standing
-- at him from the same place.

Config = {}

-- ---- The lot ----

Config.Salesman = {
    model   = 's_m_y_dealer_01',   -- Simon's dealership model
    coords  = vector4(801.48, -805.88, 26.18, 178.19),
    label   = 'Browse Vehicles',
    -- Simon's second option: the cars you own, and for each one a new key, the old keys stopped, and how many
    -- keys of it there are.
    keysLabel = 'Manage Keys',
    -- Range the purchase event trusts. Generous next to the interaction prompt's own
    -- radius, because the player may take a step while the menu is open and being thrown
    -- out mid-purchase for shuffling is worse than the risk it guards against.
    useRange = 12.0,
}

-- Where a bought vehicle appears.
Config.Delivery = vector4(800.82, -817.61, 26.18, 91.89)

-- ---- Test drive ----
-- Temporary vehicle spawned via whip_core's SpawnTempVehicle (despawnAfter removes it automatically).
Config.TestDrive = {
    enabled  = true,
    duration = 120,   -- seconds (2 minutes)
    coords   = Config.Delivery,
    returnTo = vector4(801.48, -807.88, 26.18, 0.0),   -- fallback spot in front of Simon
}

-- The lot on everyone's map, at Simon. `show = false` leaves it off. sprite and color are GTA's blip icon and colour
-- numbers (831 is GTA's car showroom, 3 is blue).
Config.Blip = {
    show   = true,
    label  = 'Car Dealership',
    sprite = 831,
    color  = 3,
    scale  = 0.8,
}

-- ---- What Simon will sell ----

-- GetVehicleClass indices. Simon runs a forecourt, not an airfield: no boats, planes,
-- helicopters, trains or military. Cycles are excluded too — he is not selling you a bike.
Config.SellableClasses = {
    [0] = true,   -- Compact
    [1] = true,   -- Sedan
    [2] = true,   -- SUV
    [3] = true,   -- Coupe
    [4] = true,   -- Muscle
    [5] = true,   -- Sports Classic
    [6] = true,   -- Sports
    [7] = true,   -- Super
    [8] = true,   -- Motorcycle
    [9] = true,   -- Off-road
    [11] = true,  -- Utility
    [12] = true,  -- Van
}

-- ---- Pricing ----
-- Base price per vehicle class, then a per-model override where one is worth writing.
Config.ClassPrice = {
    [0] = 18000,    [1] = 26000,   [2] = 42000,   [3] = 38000,
    [4] = 45000,    [5] = 68000,   [6] = 120000,  [7] = 850000,
    [8] = 22000,    [9] = 55000,   [11] = 32000,  [12] = 30000,
}

Config.ModelPrice = {
    adder      = 1000000,
    zentorno   = 725000,
    t20        = 2200000,
    osiris     = 1950000,
    blista     = 16000,
    panto      = 85000,
    faggio     = 5000,
    sanchez    = 8000,
    bati       = 15000,
    dump       = 750000,
    phantom    = 120000,
    tulip      = 60000,
    asea       = 14000,
    bison      = 30000,
}

Config.DefaultPrice = 35000

-- ---- Helpers, shared so client and server agree ----

--- What the dealership charges for a model.
--- Also resolved on the server at purchase time, never taken from the client.
---@param model string
---@param class number|nil
---@return number
function Config.PriceFor(model, class)
    local override = Config.ModelPrice[model]
    if override then return override end
    return Config.ClassPrice[class] or Config.DefaultPrice
end
