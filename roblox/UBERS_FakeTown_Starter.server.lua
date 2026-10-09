--!strict
-- Run this Script in ServerScriptService in an original place you control.
-- Select the intended app slot before publishing either separate place.
local MAP_ID = "brookhaven" -- Change to "bloxburg" in the second place.
local TOWN_NAME = if MAP_ID == "bloxburg"
	then "UBERS Bloxburg-Inspired Living Town"
	else "UBERS Brookhaven-Inspired Roleplay Town"

local Players = game:GetService("Players")
local ServerStorage = game:GetService("ServerStorage")
local Workspace = game:GetService("Workspace")
local RunService = game:GetService("RunService")

assert(MAP_ID == "brookhaven" or MAP_ID == "bloxburg", "MAP_ID must be brookhaven or bloxburg")

local function folder(parent: Instance, name: string): Folder
	local old = parent:FindFirstChild(name)
	if old then
		old:Destroy()
	end
	local result = Instance.new("Folder")
	result.Name = name
	result.Parent = parent
	return result
end

local function part(
	parent: Instance,
	name: string,
	size: Vector3,
	cframe: CFrame,
	color: Color3,
	material: Enum.Material,
	canCollide: boolean?
): Part
	local result = Instance.new("Part")
	result.Name = name
	result.Size = size
	result.CFrame = cframe
	result.Anchored = true
	result.CanCollide = canCollide ~= false
	result.Color = color
	result.Material = material
	result.TopSurface = Enum.SurfaceType.Smooth
	result.BottomSurface = Enum.SurfaceType.Smooth
	result.Parent = parent
	return result
end

local town = folder(Workspace, "UBERSStarterTown")
town:SetAttribute("UBERS_MapId", MAP_ID)
town:SetAttribute("OriginalExperience", true)

part(town, "Grass Island", Vector3.new(1080, 8, 1080), CFrame.new(0, -5, 0), Color3.fromRGB(81, 139, 77), Enum.Material.Grass)

local roadColor = Color3.fromRGB(47, 51, 58)
local sidewalkColor = Color3.fromRGB(167, 169, 164)
for offset = -400, 400, 200 do
	part(town, `Road X {offset}`, Vector3.new(1080, 0.4, 16), CFrame.new(0, -0.8, offset), roadColor, Enum.Material.Asphalt)
	part(town, `Road Z {offset}`, Vector3.new(16, 0.4, 1080), CFrame.new(offset, -0.8, 0), roadColor, Enum.Material.Asphalt)
	part(town, `Sidewalk X {offset}`, Vector3.new(1080, 0.5, 3), CFrame.new(0, -0.35, offset + 10), sidewalkColor, Enum.Material.Concrete)
	part(town, `Sidewalk Z {offset}`, Vector3.new(3, 0.5, 1080), CFrame.new(offset + 10, -0.35, 0), sidewalkColor, Enum.Material.Concrete)
end

local houseColors = {
	Color3.fromRGB(244, 185, 137),
	Color3.fromRGB(166, 202, 226),
	Color3.fromRGB(206, 185, 224),
	Color3.fromRGB(231, 220, 165),
	Color3.fromRGB(177, 207, 177),
}
local homeNumber = 0
for x = -300, 300, 200 do
	for z = -300, 300, 200 do
		homeNumber += 1
		local home = Instance.new("Model")
		home.Name = `UBERS Home {string.format("%02d", homeNumber)}`
		home.Parent = town
		local color = houseColors[(homeNumber - 1) % #houseColors + 1]
		local center = Vector3.new(x, 0, z)
		part(home, "Foundation", Vector3.new(76, 2, 64), CFrame.new(center + Vector3.new(0, 0, 0)), Color3.fromRGB(190, 185, 174), Enum.Material.Concrete)
		part(home, "House", Vector3.new(52, 24, 44), CFrame.new(center + Vector3.new(0, 13, 0)), color, Enum.Material.Brick)
		part(home, "Roof", Vector3.new(60, 4, 50), CFrame.new(center + Vector3.new(0, 27, 0)), Color3.fromRGB(80, 68, 69), Enum.Material.Slate)
		part(home, "Front Door", Vector3.new(7, 14, 1), CFrame.new(center + Vector3.new(0, 7, -22.6)), Color3.fromRGB(107, 73, 52), Enum.Material.Wood)
		part(home, "Garage", Vector3.new(17, 13, 1), CFrame.new(center + Vector3.new(17, 6.5, -22.6)), Color3.fromRGB(215, 219, 219), Enum.Material.Metal)
		for _, windowX in {-16, 16} do
			part(home, `Window {windowX}`, Vector3.new(10, 8, 0.5), CFrame.new(center + Vector3.new(windowX, 15, -22.8)), Color3.fromRGB(121, 194, 220), Enum.Material.Glass, false).Transparency = 0.25
		end
		part(home, "Walkway", Vector3.new(5, 0.3, 13), CFrame.new(center + Vector3.new(-7, -0.75, -37)), Color3.fromRGB(194, 190, 175), Enum.Material.Concrete)
	end
end

local townCenter = Vector3.new(0, 0, -100)
part(town, "Community Center", Vector3.new(90, 28, 54), CFrame.new(townCenter + Vector3.new(0, 14, 0)), Color3.fromRGB(224, 226, 211), Enum.Material.Brick)
part(town, "Community Center Roof", Vector3.new(98, 4, 60), CFrame.new(townCenter + Vector3.new(0, 30, 0)), Color3.fromRGB(78, 87, 107), Enum.Material.Slate)
part(town, "Town Park", Vector3.new(82, 0.5, 70), CFrame.new(100, -0.7, 100), Color3.fromRGB(99, 161, 89), Enum.Material.Grass)
for index, treePosition in {
	Vector3.new(70, 0, 75), Vector3.new(130, 0, 75), Vector3.new(70, 0, 125), Vector3.new(130, 0, 125)
} do
	part(town, `Park Tree Trunk {index}`, Vector3.new(4, 14, 4), CFrame.new(treePosition + Vector3.new(0, 7, 0)), Color3.fromRGB(112, 79, 55), Enum.Material.Wood)
	part(town, `Park Tree Crown {index}`, Vector3.new(16, 16, 16), CFrame.new(treePosition + Vector3.new(0, 18, 0)), Color3.fromRGB(58, 128, 68), Enum.Material.Grass)
end

local depot = Workspace:FindFirstChild("UBERSDepot")
if depot and not depot:IsA("BasePart") then
	error("Workspace.UBERSDepot exists but is not a BasePart.")
end
if not depot then
	depot = part(Workspace, "UBERSDepot", Vector3.new(24, 0.5, 24), CFrame.new(-100, -0.5, -100), Color3.fromRGB(48, 139, 184), Enum.Material.Neon)
end
depot:SetAttribute("UBERS_MapId", MAP_ID)

local function buildVehicle(kind: string, color: Color3, parent: Instance, includeNpc: boolean): Model
	local model = Instance.new("Model")
	model.Name = kind
	model:SetAttribute("UBERS_MapId", MAP_ID)
	model.Parent = parent

	local bus = kind == "bus"
	local width = if bus then 7 else 6
	local length = if bus then 16 else 11
	local chassis = part(model, "Chassis", Vector3.new(width, 1, length), CFrame.new(0, 1, 0), Color3.fromRGB(40, 43, 48), Enum.Material.Metal)
	model.PrimaryPart = chassis
	part(model, "Body", Vector3.new(width, if bus then 4 else 2.4, length - 1), CFrame.new(0, if bus then 3.5 else 2.7, 0), color, Enum.Material.Metal)
	part(model, "Windshield", Vector3.new(width - 1, 1.6, 0.4), CFrame.new(0, 3.2, -length / 2 + 0.6), Color3.fromRGB(117, 190, 214), Enum.Material.Glass, false).Transparency = 0.2
	part(model, "Rear Window", Vector3.new(width - 1, 1.5, 0.4), CFrame.new(0, 3.1, length / 2 - 0.6), Color3.fromRGB(117, 190, 214), Enum.Material.Glass, false).Transparency = 0.2

	for _, side in {-1, 1} do
		for _, endOffset in {-1, 1} do
			local wheel = part(
				model,
				`Wheel {side} {endOffset}`,
				Vector3.new(1.4, 1.4, 1.4),
				CFrame.new(side * (width / 2 + 0.15), 1, endOffset * (length / 2 - 2)) * CFrame.Angles(0, 0, math.rad(90)),
				Color3.fromRGB(31, 32, 36),
				Enum.Material.Rubber,
				false
			)
			wheel.Shape = Enum.PartType.Cylinder
		end
	end

	local driverSeat = Instance.new("VehicleSeat")
	driverSeat.Name = "DriverSeat"
	driverSeat.Size = Vector3.new(2, 1, 2)
	driverSeat.CFrame = CFrame.new(0, 2.5, -length / 2 + 2)
	driverSeat.Anchored = true
	driverSeat.Color = Color3.fromRGB(45, 50, 56)
	driverSeat.Parent = model
	local passengerSeat = Instance.new("Seat")
	passengerSeat.Name = "PassengerSeat"
	passengerSeat.Size = Vector3.new(2, 1, 2)
	passengerSeat.CFrame = CFrame.new(0, 2.5, 1)
	passengerSeat.Anchored = true
	passengerSeat.Color = Color3.fromRGB(65, 73, 78)
	passengerSeat.Parent = model
	model.PrimaryPart = chassis

	if includeNpc then
		local description = Instance.new("HumanoidDescription")
		local driver = Players:CreateHumanoidModelFromDescriptionAsync(description, Enum.HumanoidRigType.R15)
		description:Destroy()
		driver.Name = "Driver"
		driver.Parent = model
		local humanoid = driver:FindFirstChildWhichIsA("Humanoid")
		if not humanoid then
			error("Generated NPC driver is missing its Humanoid.")
		end
		humanoid.DisplayName = "UBERS NPC Driver"
		driver:PivotTo(driverSeat.CFrame * CFrame.new(0, 2, 0))
	end

	return model
end

local templates = ServerStorage:FindFirstChild("UBERSVehicles")
if templates and not templates:IsA("Folder") then
	error("ServerStorage.UBERSVehicles exists but is not a Folder.")
end
if not templates then
	templates = Instance.new("Folder")
	templates.Name = "UBERSVehicles"
	templates.Parent = ServerStorage
end
local vehicleColors = {
	car = Color3.fromRGB(73, 136, 211),
	bus = Color3.fromRGB(236, 187, 71),
	taxi = Color3.fromRGB(244, 208, 54),
}
for kind, color in vehicleColors do
	if not templates:FindFirstChild(kind) then
		buildVehicle(kind, color, templates, true)
	end
end

local demoVehicles = folder(Workspace, "UBERSDemoVehicles")
local demoSpawns = {
	{ kind = "car", color = vehicleColors.car, position = Vector3.new(-70, 0, -100) },
	{ kind = "bus", color = vehicleColors.bus, position = Vector3.new(-35, 0, -100) },
	{ kind = "taxi", color = vehicleColors.taxi, position = Vector3.new(0, 0, -100) },
}
for _, demo in demoSpawns do
	local vehicle = buildVehicle(demo.kind, demo.color, demoVehicles, false)
	vehicle.Name = `Demo {demo.kind}`
	vehicle:SetAttribute("DemoDrivable", true)
	vehicle:SetAttribute("UBERS_Vehicle", true)
	vehicle:SetAttribute("Driver", "Demo Vehicle")
	vehicle:SetAttribute("Plate", `DEMO-{string.upper(demo.kind)}`)
	vehicle:PivotTo(CFrame.new(demo.position))
end

local bounds = 500
local moveSpeed = 42
local turnSpeed = 1.7
RunService.Heartbeat:Connect(function(deltaTime)
	for _, vehicle in demoVehicles:GetChildren() do
		local seat = vehicle:FindFirstChild("DriverSeat")
		if vehicle:IsA("Model") and vehicle:GetAttribute("DemoDrivable") and seat and seat:IsA("VehicleSeat") and seat.Occupant then
			local pivot = vehicle:GetPivot()
			local throttle = seat.ThrottleFloat
			local steering = seat.SteerFloat
			if throttle ~= 0 or steering ~= 0 then
				local nextPivot = pivot
					* CFrame.new(0, 0, -throttle * moveSpeed * deltaTime)
					* CFrame.Angles(0, -steering * turnSpeed * deltaTime, 0)
				if math.abs(nextPivot.Position.X) < bounds and math.abs(nextPivot.Position.Z) < bounds then
					vehicle:PivotTo(nextPivot)
				end
			end
		end
	end
end)

print(`Built {TOWN_NAME} ({MAP_ID}) with 16 homes, a community park, drivable demo vehicles, and NPC ride templates.`)
