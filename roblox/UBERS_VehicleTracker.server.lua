--!strict
-- ROBLOX UBERS vehicle tracker
-- Place in ServerScriptService. Reports every vehicle model tagged "UBERS_Vehicle"
-- (or listed in VEHICLE_NAMES) to the UBERS website so it shows on the live map.

local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local BASE_URL = "http://localhost:3000" -- change to your deployed site (no trailing slash)
local TRACKING_TOKEN = "change-me-to-a-long-random-string" -- must match .env TRACKING_TOKEN
local MAP_ID = "brookhaven" -- "brookhaven" or "bloxburg"
local REPORT_EVERY = 3 -- seconds
local TYPE_BY_NAME = {
	["bus"] = "bus",
	["taxi"] = "taxi",
	["car"] = "car",
}

local function mapVector(p: Vector3): { x: number, y: number }
	-- World (-500..500) -> map space (0..1000)
	return {
		x = math.clamp((p.X + 500) / 1000 * 1000, 0, 1000),
		y = math.clamp((p.Z + 500) / 1000 * 1000, 0, 1000),
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

local function report()
	local ok, err = pcall(function()
		local vehicles = collectVehicles()
		if #vehicles == 0 then
			return
		end
		HttpService:RequestAsync({
			Url = BASE_URL .. "/api/tracking/ping",
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["x-ubers-token"] = TRACKING_TOKEN,
			},
			Body = HttpService:JSONEncode({ token = TRACKING_TOKEN, map = MAP_ID, vehicles = vehicles }),
		})
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
