
const requiredClients = 4;
const requiredGMs = 2;

let testState;
let connectedUsers;
let connectedGMs;
let otherUsers;
let otherGM;
let otherNonGM;

let socket;

Hooks.once("ready", () => {
	window.socketlibTest = {
		run: runTests,
		reload: () => socket.executeForEveryone(reload),
		activate: () => socket.executeForEveryone(broadcastActivity),
	}
	ui.notifications.info(`${game.user.name} (${game.user.id})`, {permanent: true});
	broadcastActivity();
});

Hooks.once("socketlib.ready", () => {
	socket = socketlib.registerModule("socketlib-test");
	socket.register("reload", reload);
	socket.register("init", initTest);
	socket.register("invoke0", invokeWithoutParams);
	socket.register("invoke1", invokeWith1Parameter);
	socket.register("invoke2", invokeWith2Parameters);
	socket.register("failing", failing);
	socket.register("result", reportResult);
	socket.register("testExecuteAsGM", testExecuteAsGM);
	socket.register("testExecuteForAllGMs", testExecuteForAllGMs);
	socket.register("broadcastActivity", broadcastActivity);
	socket.register("initializeUsers", initializeUsers);
});

async function runTests() {
	if (!game.user.isGM) {
		const msg = "The testbench must be started on a GM client.";
		ui.notifications.error(msg);
		console.error(msg);
		return;
	}

	try {
		try {
			initializeUsers();
		}
		catch (msg) {
			socketlibTest.activate();
			await sleep(250);
			initializeUsers();
		}
	}
	catch (msg) {
		ui.notifications.error(msg);
		console.error(msg);
		return;
	}

	const tests = [
		bootstrapTestExecuteAsUserRemote,
		bootstrapTestExecuteAsUserLocal,
		bootstrapTestExecuteForEveryone,
		boostrapInitializeOthers,
		testExecuteAsGMFromGM,
		testExecuteAsGMFromUser,
		testExecuteForAllGMsFromGM,
		testExecuteForAllGMsFromUser,
		testExecuteForOthers,
		testExecuteForOtherGMs,
		testTransferringNoParams,
		testTransferringOneParam,
		testTransferringTwoParams,
		testThisValueCommandRemote,
		testThisValueCommandLocal,
		testThisValueRequestRemote,
		testThisValueRequestLocal,
		testExecuteForEveryoneSurvivesErroringFunction,
		testExecuteForAllGMsSurvivesErroringFunction,
		testExecuteForUsersSurvivesErroringFunctionLocal,
		testExecuteForUsersSurvivesErroringFunctionRemote,
		testRequestErrorsOnErrorLocal,
		testRequestErrorsOnErrorRemote,
	];

	let successes = 0;
	for (const [i, test] of tests.entries()) {
		const msg = `(${i + 1}/${tests.length}) ${test.name} `;
		try {
			const result = await test();
			if (result === true) {
				console.log(msg + "success");
				successes += 1;
			}
			else {
				console.error(msg + "failed");
				console.error(result);
			}
		}
		catch (e) {
			console.error(msg + "failed with an exception");
			console.error(e);
		}
	}

	const msg = `${successes}/${tests.length} tests were successful`;
	if (successes === tests.length) {
		console.log(msg);
		ui.notifications.info(msg);
	}
	else {
		console.warn(msg);
		ui.notifications.warn(msg);
	}
}

async function bootstrapTestExecuteAsUser(user) {
	const results = [];
	await socket.executeAsUser(initTest, user.id);
	let result = await socket.executeAsUser(reportResult, user.id);
	results.push(result);
	if (result !== undefined) {
		return results;
	}
	await socket.executeAsUser(invokeWithoutParams, user.id);
	result = await socket.executeAsUser(reportResult, user.id);
	results.push(result);
	if (result?.args === undefined) {
		return results;
	}
	return true;
}

function bootstrapTestExecuteAsUserRemote() {
	return bootstrapTestExecuteAsUser(otherUsers[0]);
}

function bootstrapTestExecuteAsUserLocal() {
	return bootstrapTestExecuteAsUser(game.user);
}

async function bootstrapTestExecuteForEveryone() {
	await socket.executeForEveryone(initTest);
	const results = [];
	let result = await collectResultsExpectingSuccess();
	results.push(result);
	if (Array.from(result.results.values()).some(val => val !== undefined)) {
		return results;
	}
	await socket.executeForEveryone(invokeWithoutParams);
	result = await collectResultsExpectingSuccess();
	results.push(result);
	if (Array.from(result.results.values()).some(val => val === undefined)) {
		return results;
	}
	return true;
}

async function boostrapInitializeOthers() {
	// Let all users broadcast their activity
	const startTime = Date.now();
	await Promise.all(connectedUsers.map(user => socket.executeAsUser(broadcastActivity, user.id)));
	const roundtripTime = Date.now() - startTime;
	// Give enough time for the activity boradcasts to propagate
	await sleep(roundtripTime * 3);
	await Promise.all(otherUsers.map(user => socket.executeAsUser(initializeUsers, user.id)));
	return true;
}

async function testExecuteAsGM() {
	await socket.executeForEveryone(initTest);
	await socket.executeAsGM(invokeWithoutParams);
	const results = await collectResultsExpectingSuccess();
	let executingUser;
	for (const [user, result] of results.results) {
		if (result !== undefined) {
			if (executingUser !== undefined)
				return serializeResult(results);
			executingUser = user;
		}
	}
	if (executingUser === undefined) {
		return serializeResult(results);
	}
	if (!game.users.get(executingUser).isGM) {
		return serializeResult(results);
	}
	return true;
}

async function testExecuteAsGMFromGM() {
	return  deserializeResult(await testExecuteAsGM());
}

async function testExecuteAsGMFromUser() {
	return deserializeResult(await socket.executeAsUser(testExecuteAsGM, otherNonGM.id));
}


async function testExecuteForAllGMs() {
	await socket.executeForEveryone(initTest);
	await socket.executeForAllGMs(invokeWithoutParams);
	const results = await collectResultsExpectingSuccess();
	const success = Array.from(results.results.entries()).every(([userId, result]) => {
		if (game.users.get(userId).isGM) {
			return result !== undefined;
		}
		else {
			return result === undefined;
		}
	});
	if (!success)
		return serializeResult(results);
	return true;
}

async function testExecuteForAllGMsFromGM() {
	return deserializeResult(await testExecuteForAllGMs());
}

async function testExecuteForAllGMsFromUser() {
	return deserializeResult(await socket.executeAsUser(testExecuteForAllGMs, otherNonGM.id));
}

async function testExecuteForOthers() {
	await socket.executeForEveryone(initTest);
	await socket.executeForOthers(invokeWithoutParams);
	const results = await collectResultsExpectingSuccess();
	const success = Array.from(results.results.entries()).every(([userId, result]) => {
		if (userId !== game.userId) {
			return result !== undefined;
		}
		else {
			return result === undefined;
		}
	});
	if (!success)
		return results;
	return true;
}

async function testExecuteForOtherGMs() {
	await socket.executeForEveryone(initTest);
	await socket.executeForOtherGMs(invokeWithoutParams);
	const results = await collectResultsExpectingSuccess();
	const success = Array.from(results.results.entries()).every(([userId, result]) => {
		if (userId !== game.userId && game.users.get(userId).isGM) {
			return result !== undefined;
		}
		else {
			return result === undefined;
		}
	});
	if (!success)
		return results;
	return true;
}

async function testTransferringNoParams() {
	const user = otherUsers[0];
	await socket.executeForEveryone(initTest);
	await socket.executeAsUser(invokeWithoutParams, user.id);
	const result = await socket.executeAsUser(reportResult, user.id);
	if (!(result.args instanceof Array) || result.args.length !== 0)
		return result;
	return true;
}

async function testTransferringOneParam() {
	const user = otherUsers[0];
	const parameterValue = "foobar";
	await socket.executeForEveryone(initTest);
	await socket.executeAsUser(invokeWith1Parameter, user.id, parameterValue);
	const result = await socket.executeAsUser(reportResult, user.id);
	if (!(result.args instanceof Array) || result.args.length !== 1 || result.args[0] !== parameterValue)
		return result;
	return true;
}

async function testTransferringTwoParams() {
	const user = otherUsers[0];
	const parameterValues = ["foo", "bar"];
	await socket.executeForEveryone(initTest);
	await socket.executeAsUser(invokeWith2Parameters, user.id, parameterValues[0], parameterValues[1]);
	const result = await socket.executeAsUser(reportResult, user.id);
	if (!(result.args instanceof Array) || result.args.length !== 2 || result.args[0] !== parameterValues[0] || result.args[1] !== parameterValues[1])
		return result;
	return true;
}

async function testThisValue(user, invokeOverSocket) {
	await socket.executeForEveryone(initTest);
	await invokeOverSocket(invokeWithoutParams, user.id);
	const result = await socket.executeAsUser(reportResult, user.id);
	if (result._this !== undefined)
		return result;
	return true;
}

function testThisValueCommand(user) {
	return testThisValue(user, sendCommand);
}

function testThisValueRequest(user) {
	return testThisValue(user, sendRequest);
}

function testThisValueCommandRemote() {
	return testThisValueCommand(otherUsers[0]);
}

function testThisValueCommandLocal() {
	return testThisValueCommand(game.user);
}

function testThisValueRequestRemote() {
	return testThisValueRequest(otherUsers[0]);
}

function testThisValueRequestLocal() {
	return testThisValueRequest(game.user);
}

async function testCommandSurvivesErroringFunction(invokeOverSocket) {
	await socket.executeForEveryone(initTest);
	await invokeOverSocket();
	return true;
}

function testExecuteForEveryoneSurvivesErroringFunction() {
	return testCommandSurvivesErroringFunction(() => socket.executeForEveryone(failing));
}

function testExecuteForAllGMsSurvivesErroringFunction() {
	return testCommandSurvivesErroringFunction(() => socket.executeForAllGMs(failing));
}

function testExecuteForUsersSurvivesErroringFunctionLocal() {
	return testCommandSurvivesErroringFunction(() => socket.executeForUsers(failing, [game.user.id]));
}

function testExecuteForUsersSurvivesErroringFunctionRemote() {
	return testCommandSurvivesErroringFunction(() => socket.executeForUsers(failing, [otherUsers[0].id]));
}

async function testRequestErrorsOnError(user) {
	await socket.executeForEveryone(initTest);
	try {
		await socket.executeAsUser(failing, user.id);
		return false;
	}
	catch (e) {
		// Nothing to do
	}
	return true
}

function testRequestErrorsOnErrorLocal() {
	return testRequestErrorsOnError(game.user);
}

function testRequestErrorsOnErrorRemote() {
	return testRequestErrorsOnError(otherUsers[0]);
}

function sendCommand(func, userId) {
	return socket.executeForUsers(func, [userId]);
}

function sendRequest(func, userId) {
	return socket.executeAsUser(func, userId);
}

function initTest() {
	testState = undefined;
}

function invokeWithoutParams() {
	testState = {_this: this, args: []};
}

function invokeWith1Parameter(par1) {
	testState = {_this: this, args: [par1]};
}

function invokeWith2Parameters(par1, par2) {
	testState = {_this: this, args: [par1, par2]};
}

function failing() {
	throw new Error("This function always fails. This exception may be shown as a normal part of the testing procedure. Check the report to see if all tests were sucessful.");
}

function reportResult() {
	return testState;
}

function initializeUsers() {
	connectedUsers = game.users.filter(user => user.active);
	connectedGMs = connectedUsers.filter(user => user.isGM);
	if (connectedUsers.length != 4 || connectedGMs.length != 2) {
		throw `To run the testbench, exactly ${requiredClients} clients need to be connected: ${requiredGMs} GMs and ${requiredClients - requiredGMs} regular players. Currently ${connectedUsers.length} clients are connected, with ${connectedGMs.length} of them being GM clients.`;
	}

	otherUsers = connectedUsers.filter(user => user.id != game.userId);
	otherGM = otherUsers.find(user => user.isGM);
	otherNonGM = otherUsers.find(user => !user.isGM);
}

function collectResults() {
	const pendingResults = new Map();
	for (const user of connectedUsers) {
		pendingResults.set(user.id, socket.executeAsUser(reportResult, user.id));
	}
	return pendingResults;
}

async function collectResultsExpectingSuccess() {
	const pendingReulsts = collectResults();
	const results = {executingUser: game.userId, results: new Map()};
	for (const [userId, promise] of pendingReulsts) {
		results.results.set(userId, await promise);
	}
	return results;
}

function reload() {
	location.reload();
}

function broadcastActivity() {
	return game.user.broadcastActivity();
}

function sleep(milliseconds) {
	return new Promise((resolve, reject) => window.setTimeout(resolve, milliseconds));
}

function serializeResult(result) {
	if (result === true)
		return true;
	const serialized = {executingUser: result.executingUser};
	serialized.results = Array.from(result.results.entries());
	return serialized;
}

function deserializeResult(result) {
	if (result === true)
		return true;
	const deserialized = {executingUser: result.executingUser};
	const map = new Map();
	for (let [key, value] of result.results) {
		if (value === null)
			value = undefined;
		map.set(key, value);
	}
	deserialized.results = map;
	return deserialized;
}
