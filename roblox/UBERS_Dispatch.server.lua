--!strict
-- Owner-installed roleplay NPC ride dispatcher.
-- This only runs in an experience whose creator installs and configures it.

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ServerStorage = game:GetService("ServerStorage")
local Workspace = game:GetService("Workspace")

local BASE_URL = "https://your-public-ubers-server.example.com"
local TRACKING_TOKEN = "change-me-to-a-long-random-string"
local MAP_ID = "brookhaven" -- "brookhaven" or "bloxburg"; must match your own map setup
local WORLD_MIN_X = -500
local WORLD_MAX_X = 500
local WORLD_MIN_Z = -500
local WORLD_MAX_Z = 500
local POLL_EVERY = 10
local CRUISE_SPEED = 45
local PICKUP_WAIT_SECONDS = 5
local PASSENGER_WAIT_SECONDS = 180

local serverId = if game.JobId ~= "" then game.JobId else HttpService:GenerateGUID(false)
local busy = false

local function request(method: string, endpoint: string, payload: { [string]: any }?): (boolean, any)
	local options: { [string]: any } = {
		Url = BASE_URL .. endpoint,
		Method = method,
		Headers = {
			["Content-Type"] = "application/json",
			["x-ubers-token"] = TRACKING_TOKEN,
			["cf-skip-browser-warning"] = "1",
		},
	}
	if payload then
		options.Body = HttpService:JSONEncode(payload)
	end

	local ok, response = pcall(function()
		return HttpService:RequestAsync(options)
	end)
	if not ok then
		warn("[UBERS] request failed: " .. tostring(response))
		return false, nil
	end
	if not response.Success then
		warn(`[UBERS] {endpoint} returned HTTP {response.StatusCode}`)
		return false, nil
	end
	local decodedOk, decoded = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)
	if not decodedOk then
		warn("[UBERS] API returned invalid JSON.")
		return false, nil
	end
	return true, decoded
end

local function worldPosition(point: { x: number, y: number }): Vector3
	return Vector3.new(
		WORLD_MIN_X + (point.x / 1000) * (WORLD_MAX_X - WORLD_MIN_X),
		0,
		WORLD_MIN_Z + (point.y / 1000) * (WORLD_MAX_Z - WORLD_MIN_Z)
	)
end

local function setRideStatus(reference: string, status: string)
	local ok = request("POST", `/api/roblox/dispatch/{HttpService:UrlEncode(reference)}/status`, {
		serverId = serverId,
		status = status,
	})
	if not ok then
		warn(`[UBERS] Could not update ride {reference} to {status}.`)
	end
end

local function moveVehicle(vehicle: Model, start: Vector3, finish: Vector3)
	local distance = (finish - start).Magnitude
	local duration = math.clamp(distance / CRUISE_SPEED, 1, 90)
	local elapsed = 0
	while elapsed < duration and vehicle.Parent do
		local alpha = math.clamp(elapsed / duration, 0, 1)
		local position = start:Lerp(finish, alpha)
		local direction = finish - position
		if direction.Magnitude > 0.01 then
			vehicle:PivotTo(CFrame.lookAt(position, finish))
		end
		elapsed += RunService.Heartbeat:Wait()
	end
	if not vehicle.Parent then
		error("Vehicle was removed before reaching its destination.")
	end
	vehicle:PivotTo(CFrame.lookAt(finish, finish + (finish - start)))
end

local function runRide(ride: { [string]: any })
	local vehicle: Model? = nil
	local ok, err = pcall(function()
		local vehiclesFolder = ServerStorage:FindFirstChild("UBERSVehicles")
		if not vehiclesFolder or not vehiclesFolder:IsA("Folder") then
			error("Create ServerStorage/UBERSVehicles and add your own car, bus, and taxi templates.")
		end
		local template = vehiclesFolder:FindFirstChild(ride.route.type)
		if not template or not template:IsA("Model") or not template.PrimaryPart then
			error(`Missing a Model with PrimaryPart at ServerStorage/UBERSVehicles/{ride.route.type}.`)
		end
		local depot = Workspace:FindFirstChild("UBERSDepot")
		if not depot or not depot:IsA("BasePart") then
			error("Add a BasePart named UBERSDepot to Workspace.")
		end

		local spawnedVehicle = template:Clone()
		vehicle = spawnedVehicle
		spawnedVehicle.Name = `UBERS_{ride.route.type}_{ride.reference}`
		spawnedVehicle:SetAttribute("UBERS_Vehicle", true)
		spawnedVehicle:SetAttribute("UBERS_RideReference", ride.reference)
		spawnedVehicle:SetAttribute("Driver", "UBERS NPC")
		spawnedVehicle:SetAttribute("Plate", ride.reference)
		spawnedVehicle.Parent = Workspace
		spawnedVehicle:PivotTo(CFrame.lookAt(depot.Position, worldPosition(ride.pickup)))

		local driver = spawnedVehicle:FindFirstChild("Driver", true)
		local humanoid = driver and driver:FindFirstChildWhichIsA("Humanoid")
		local seat = spawnedVehicle:FindFirstChild("DriverSeat", true)
		if not seat then
			seat = spawnedVehicle:FindFirstChildWhichIsA("VehicleSeat", true)
		end
		if not humanoid or not seat then
			error("Each vehicle template needs a Driver NPC with a Humanoid and a VehicleSeat named DriverSeat.")
		end
		seat:Sit(humanoid)

		local pickup = worldPosition(ride.pickup)
		local dropoff = worldPosition(ride.dropoff)
		setRideStatus(ride.reference, "enroute")
		moveVehicle(spawnedVehicle, depot.Position, pickup)
		setRideStatus(ride.reference, "arrived")
		local profile = ride.robloxProfile
		local riderUserId = profile and tonumber(profile.userId)
		if not riderUserId then
			error("The booking must include a public Roblox profile username.")
		end
		local passengerSeat = spawnedVehicle:FindFirstChild("PassengerSeat", true)
		if not passengerSeat or not (passengerSeat:IsA("Seat") or passengerSeat:IsA("VehicleSeat")) then
			error("Each vehicle template needs a Seat named PassengerSeat.")
		end
		local deadline = os.clock() + PASSENGER_WAIT_SECONDS
		local passengerHumanoid: Humanoid? = nil
		while os.clock() < deadline and spawnedVehicle.Parent do
			local passenger = Players:GetPlayerByUserId(riderUserId)
			local character = passenger and passenger.Character
			local candidate = character and character:FindFirstChildWhichIsA("Humanoid")
			if candidate and candidate.Health > 0 then
				passengerSeat:Sit(candidate)
				if passengerSeat.Occupant == candidate then
					passengerHumanoid = candidate
					break
				end
			end
			task.wait(2)
		end
		if not passengerHumanoid then
			error("Booked Roblox user did not join this game server and board before timeout.")
		end
		task.wait(PICKUP_WAIT_SECONDS)
		setRideStatus(ride.reference, "picked_up")
		moveVehicle(spawnedVehicle, pickup, dropoff)
		passengerHumanoid.Sit = false
		setRideStatus(ride.reference, "completed")
		spawnedVehicle:Destroy()
		vehicle = nil
	end)

	if not ok then
		warn("[UBERS] NPC ride failed: " .. tostring(err))
		if vehicle then
			vehicle:Destroy()
		end
		setRideStatus(ride.reference, "failed")
	end
	busy = false
end

local function pollForRide()
	if busy then
		return
	end
	local ok, result = request("GET", `/api/roblox/dispatch/next?map={HttpService:UrlEncode(MAP_ID)}`, nil)
	if not ok or not result.ride then
		return
	end

	local claimed, claimResult = request("POST", "/api/roblox/dispatch/claim", {
		reference = result.ride.reference,
		mapId = MAP_ID,
		serverId = serverId,
	})
	if not claimed or not claimResult.ride then
		return
	end

	busy = true
	task.spawn(runRide, claimResult.ride)
end

if BASE_URL == "" or BASE_URL:find("your%-public%-ubers%-server") or TRACKING_TOKEN == "change-me-to-a-long-random-string" then
	warn("[UBERS] Set BASE_URL and TRACKING_TOKEN before using the NPC dispatcher.")
else
	task.spawn(function()
		while true do
			pollForRide()
			task.wait(POLL_EVERY)
		end
	end)
end
