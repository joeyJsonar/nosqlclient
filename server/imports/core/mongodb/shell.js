import { Meteor } from 'meteor/meteor';
import { Database, Logger, Error } from '/server/imports/modules';
import { Connection } from '/server/imports/core';
import MongoDBHelper from './helper';

const spawn = require('cross-spawn');

const MongoDBShell = () => {
  this.spawnedShellsBySessionId = {};
};

function setEventsToShell(connectionId, sessionId) {
  Logger.info({ message: 'shell-event-bind', metadataToLog: { connectionId, sessionId } });

  this.spawnedShellsBySessionId[sessionId].on('error', Meteor.bindEnvironment((err) => {
    Logger.error({ message: 'shell-event-bind-error', metadataToLog: { error: err, sessionId } });
    this.spawnedShellsBySessionId[sessionId] = null;
    if (err) {
      Database.create({
        type: Database.types.ShellCommands,
        document: {
          date: Date.now(),
          sessionId,
          connectionId,
          message: `unexpected error ${err.message}`,
        }
      });
    }
  }));

  this.spawnedShellsBySessionId[sessionId].stdout.on('data', Meteor.bindEnvironment((data) => {
    if (data && data.toString()) {
      Database.create({
        type: Database.types.ShellCommands,
        document: {
          date: Date.now(),
          sessionId,
          connectionId,
          message: data.toString(),
        }
      });
    }
  }));

  this.spawnedShellsBySessionId[sessionId].stderr.on('data', Meteor.bindEnvironment((data) => {
    if (data && data.toString()) {
      Database.create({
        type: Database.types.ShellCommands,
        document: {
          date: Date.now(),
          sessionId,
          connectionId,
          message: data.toString()
        }
      });
    }
  }));

  this.spawnedShellsBySessionId[sessionId].on('close', Meteor.bindEnvironment((code) => {
    // show ended message in codemirror
    Database.create({
      type: Database.types.ShellCommands,
      document: {
        date: Date.now(),
        connectionId,
        sessionId,
        message: `shell closed ${code.toString()}`
      }
    });

    this.spawnedShellsBySessionId[sessionId] = null;
    Meteor.setTimeout(() => {
      // remove all for further
      Database.remove({ type: Database.types.ShellCommands, selector: { sessionId } });
    }, 500);
  }));
}

MongoDBShell.prototype = {
  connectToShell({ connectionId, username, password, sessionId }) {
    const connection = Database.readOne({ type: Database.types.Connections, query: { _id: connectionId } });

    try {
      if (!this.this.spawnedShellsBySessionId[sessionId]) {
        const connectionUrl = Connection.getConnectionUrl(connection, false, username, password, true);
        const mongoPath = MongoDBHelper.getProperBinary('mongo');
        Logger.info({ message: 'shell', metadataToLog: { mongoPath, connectionUrl, sessionId } });
        this.this.spawnedShellsBySessionId[sessionId] = spawn(mongoPath, [connectionUrl]);
        setEventsToShell(connectionId, sessionId);
      }
    } catch (ex) {
      this.this.spawnedShellsBySessionId[sessionId] = null;
      Error.create({ type: Error.types.ShellError, exception: ex, metadataToLog: { connectionId, username, sessionId } });
    }

    if (this.this.spawnedShellsBySessionId[sessionId]) {
      Logger.info({ message: 'shell', metadataToLog: { command: `"use ${connection.databaseName}" on shell`, sessionId } });
      this.this.spawnedShellsBySessionId[sessionId].stdin.write(`use ${connection.databaseName}\n`);
      return `use ${connection.databaseName}`;
    }

    throw new Meteor.Error("Couldn't spawn shell, please check logs !");
  },

  clearShell({ sessionId }) {
    Logger.info({ message: 'clearShell', metadataToLog: sessionId });
    Database.remove({ type: Database.types.ShellCommands, selector: { sessionId } });
  },

  executeShellCommand({ command, connectionId, username, password, sessionId }) {
    Logger.info({ message: 'shellCommand', metadataToLog: { sessionId, command, connectionId } });
    if (!this.spawnedShellsBySessionId[sessionId]) this.connectToShell(connectionId, username, password, sessionId);
    if (this.spawnedShellsBySessionId[sessionId]) this.spawnedShellsBySessionId[sessionId].stdin.write(`${command}\n`);
  }
};

export default new MongoDBShell();
