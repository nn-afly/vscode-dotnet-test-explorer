import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { Disposable, Event, EventEmitter } from "vscode";
import { AppInsightsClient } from "./appInsightsClient";
import { Executor } from "./executor";
import { Logger } from "./logger";
import { IMessagesController } from "./messages";
import { discoverTests } from "./testDiscovery";
import { TestNode } from "./testNode";
import { TestResultsFile } from "./testResultsFile";
import { Utility } from "./utility";

export interface ITestCommand {
    testName: string;
    skipBuild: boolean;
}

export class TestCommands {
    private onNewTestDiscoveryEmitter = new EventEmitter<string[]>();
    private onTestRunEmitter = new EventEmitter<string>();
    private testDirectoryPath: string;
    private lastTestCommand: ITestCommand;

    constructor(
        private resultsFile: TestResultsFile,
        private messagesController: IMessagesController) { }

    /**
     * @description
     * Runs all tests discovered in the project directory.
     * @summary
     * This method can cause the project to rebuild or try
     * to do a restore, so it can be very slow.
     */
    public runAllTests(testCommand: ITestCommand): void {
        this.runTestCommand(testCommand);
        AppInsightsClient.sendEvent("runAllTests");
    }

    /**
     * @description
     * Runs a specific test discovered from the project directory.
     * @summary
     * This method can cause the project to rebuild or try
     * to do a restore, so it can be very slow.
     */
    public runTest(testCommand: ITestCommand): void {
        this.runTestByName(testCommand);
    }

    public runTestByName(testCommand: ITestCommand): void {
        this.runTestCommand(testCommand);
        AppInsightsClient.sendEvent("runTest");
    }

    public rerunLastCommand(): void {
        if (this.lastTestCommand != null) {
            this.runTestCommand(this.lastTestCommand);
            AppInsightsClient.sendEvent("rerunLastCommand");
        }
    }

    public discoverTests() {
        this.evaluateTestDirectory();

        discoverTests(this.testDirectoryPath, this.getDotNetTestOptions())
            .then((result) => {
                if (result.warningMessage) {
                    Logger.LogWarning(result.warningMessage.text);

                    this.messagesController.showWarningMessage(result.warningMessage);
                }

                this.onNewTestDiscoveryEmitter.fire(result.testNames);
            })
            .catch((err) => {
                Logger.LogError("Error while discovering tests", err);

                this.onNewTestDiscoveryEmitter.fire([]);
            });
    }

    public get onNewTestDiscovery(): Event<string[]> {
        return this.onNewTestDiscoveryEmitter.event;
    }

    public get onTestRun(): Event<string> {
        return this.onTestRunEmitter.event;
    }

    private runTestCommand(testCommand: ITestCommand): void {
        let command = `dotnet test${this.getDotNetTestOptions()}${this.outputTestResults()}`;
        if (testCommand.testName && testCommand.testName.length) {
            command = command + ` --filter FullyQualifiedName~${testCommand.testName.replace(/\(.*\)/g, "")}`;
        }

        if (testCommand.skipBuild) {
            command = command + ` --no-build`;
        }

        this.lastTestCommand = {
            testName: testCommand.testName,
            skipBuild: testCommand.skipBuild,
        };

        Logger.Log(`Executing ${command} in ${this.testDirectoryPath}`);
        this.onTestRunEmitter.fire(testCommand.testName);
        Executor.runInTerminal(command, this.testDirectoryPath);
    }

    /**
     * @description
     * Discover the directory where the dotnet-cli
     * will execute commands, taken from the options.
     * @summary
     * This will be the @see{vscode.workspace.rootPath}
     * by default.
     */
    private evaluateTestDirectory(): void {
        let testProjectFullPath = this.checkTestDirectoryOption();
        testProjectFullPath = Utility.resolvePath(testProjectFullPath);

        if (!fs.existsSync(testProjectFullPath)) {
            Logger.Log(`Path ${testProjectFullPath} is not valid`);
        }

        this.testDirectoryPath = testProjectFullPath;
    }

    /**
     * @description
     * Checks to see if the options specify that the dotnet-cli
     * should run `dotnet build` before loading tests.
     * @summary
     * If this is set to **false**, then `--no-build` is passed into the
     * command line arguments. It is prefixed by a space only if **false**.
     */
    private checkBuildOption(): string {
        const option = Utility.getConfiguration().get<boolean>("build");
        return option ? "" : " --no-build";
    }

    /**
     * @description
     * Checks to see if the options specify that the dotnet-cli
     * should run `dotnet restore` before loading tests.
     * @summary
     * If this is set to **false**, then `--no-restore` is passed into the
     * command line arguments. It is prefixed by a space only if **false**.
     */
    private checkRestoreOption(): string {
        const option = Utility.getConfiguration().get<boolean>("restore");
        return option ? "" : " --no-restore";
    }

    /**
     * @description
     * Gets the options for build/restore before running tests.
     */
    private getDotNetTestOptions(): string {
        return this.checkBuildOption() + this.checkRestoreOption();
    }

    /**
     * @description
     * Gets the dotnet test argument to speicfy the output for the test results.
     */
    private outputTestResults(): string {
        if (Utility.codeLensEnabled) {
            return " --logger \"trx;LogFileName=" + this.resultsFile.fileName + "\"";
        } else {
            return "";
        }
    }

    /**
     * @description
     * Checks to see if the options specify a directory to run the
     * dotnet-cli test commands in.
     * @summary
     * This will use the project root by default.
     */
    private checkTestDirectoryOption(): string {
        const option = Utility.getConfiguration().get<string>("testProjectPath");
        return option ? option : vscode.workspace.rootPath;
    }

}
