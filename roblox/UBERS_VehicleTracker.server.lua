--!strict
-- ROBLOX UBERS vehicle tracker
-- Place in ServerScriptService in a Roblox experience you own. Reports anonymous
-- player positions and tagged vehicles to your publicly reachable UBERS server.

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")

local BASE_URL = "https://your-public-ubers-server.example.com" -- HTTPS URL, no trailing slash
local TRACKING_TOKEN = "change-me-to-a-long-random-string" -- must match .env TRACKING_TOKEN
local MAP_ID = "brookhaven" -- "brookhaven" or "bloxburg"
local REPORT_EVERY = 5 -- seconds
local WORLD_MIN_X = -500 -- Set these four bounds to the playable map edges in studs.
local WORLD_MAX_X = 500
local WORLD_MIN_Z = -500
local WORLD_MAX_Z = 500
local serverId = if game.JobId ~= "" then game.JobId else HttpService:GenerateGUID(false)
local TYPE_BY_NAME = {
	["bus"] = "bus",
	["taxi"] = "taxi",
	["car"] = "car",
}

local function mapVector(p: Vector3): { x: number, y: number }
	-- Normalize world coordinates to the map's 0..1000 coordinate space.
	return {
		x = math.clamp((p.X - WORLD_MIN_X) / (WORLD_MAX_X - WORLD_MIN_X) * 1000, 0, 1000),
		y = math.clamp((p.Z - WORLD_MIN_Z) / (WORLD_MAX_Z - WORLD_MIN_Z) * 1000, 0, 1000),
	}
end

local function detectType(model: Model): string
	local n = model.Name:lower()
	for key, value in pairs(TYPE_BY_NAME) do
		if n:find(key) then
			return value
		end
	end
	return "car"
end

local function collectVehicles(): { any }
	local list = {}
	for _, inst in ipairs(Workspace:GetDescendants()) do
		if inst:IsA("Model") and (inst:GetAttribute("UBERS_Vehicle") == true or inst:IsA("VehicleSeat")) then
			local root = inst:FindFirstChild("HumanoidRootPart") or inst:FindFirstChildWhichIsA("BasePart")
			if root then
				local pos = mapVector(root.Position)
				table.insert(list, {
					id = inst:GetFullName(),
					map = MAP_ID,
					type = detectType(inst),
					x = math.floor(pos.x),
					y = math.floor(pos.y),
					heading = math.floor(root.Orientation.Y),
					driver = (inst:GetAttribute("Driver") :: string?) or "Roblox Driver",
					plate = (inst:GetAttribute("Plate") :: string?) or nil,
					status = "enroute",
				})
			end
		end
	end
	return list
end

local function collectPlayers(): { any }
	local list = {}
	for _, player in ipairs(Players:GetPlayers()) do
		local character = player.Character
		local root = character and character:FindFirstChild("HumanoidRootPart")
		if player:GetAttribute("UBERS_TrackingOptOut") ~= true and root and root:IsA("BasePart") then
			local world = root.Position
			if world.X >= WORLD_MIN_X and world.X <= WORLD_MAX_X and world.Z >= WORLD_MIN_Z and world.Z <= WORLD_MAX_Z then
				local pos = mapVector(world)
				table.insert(list, {
					userId = player.UserId,
					x = math.floor(pos.x),
					y = math.floor(pos.y),
					heading = math.floor(root.Orientation.Y),
				})
			end
		end
	end
	return list
end

local function post(endpoint: string, payload: { [string]: any })
	local response = HttpService:RequestAsync({
		Url = BASE_URL .. endpoint,
		Method = "POST",
		Headers = {
			["Content-Type"] = "application/json",
			["x-ubers-token"] = TRACKING_TOKEN,
		},
		Body = HttpService:JSONEncode(payload),
	})
	if not response.Success then
		warn(`[UBERS] {endpoint} returned HTTP {response.StatusCode}`)
	end
end

local function report()
	local ok, err = pcall(function()
		post("/api/players/ping", {
			map = MAP_ID,
			serverId = serverId,
			players = collectPlayers(),
		})
		local vehicles = collectVehicles()
		if #vehicles > 0 then
			post("/api/tracking/ping", { map = MAP_ID, vehicles = vehicles })
		end
	end)
	if not ok then
		warn("[UBERS] report failed: " .. tostring(err))
	end
end

task.spawn(function()
	while true do
		report()
		task.wait(REPORT_EVERY)
	end
end)
