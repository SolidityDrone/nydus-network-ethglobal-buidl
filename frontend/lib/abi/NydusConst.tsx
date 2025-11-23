export const NydusAddress = "0x027cAAf9f84CF0882d61174e06681F0463E4b859" as const;
export const NydusAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_verifiers",
        "type": "address[]",
        "internalType": "address[]"
      },
      {
        "name": "identityVerificationHubV2Address",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "scopeSeed",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "_verificationConfig",
        "type": "tuple",
        "internalType": "struct SelfUtils.UnformattedVerificationConfigV2",
        "components": [
          {
            "name": "olderThan",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "forbiddenCountries",
            "type": "string[]",
            "internalType": "string[]"
          },
          {
            "name": "ofacEnabled",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "absorb",
    "inputs": [
      {
        "name": "_proof",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_publicInputs",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "addCommitments",
    "inputs": [
      {
        "name": "c1X",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "c1Y",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "c2X",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "c2Y",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "resultX",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "resultY",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "addNoteCommitment",
    "inputs": [
      {
        "name": "pubKey",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "newNoteStackX",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "newNoteStackY",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "m",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "r",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "resultX",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "resultY",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "newCount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "addStateCommitment",
    "inputs": [
      {
        "name": "x",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "y",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "m",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "r",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "d",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "resultX",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "resultY",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "balanceCommitmentStack",
    "inputs": [
      {
        "name": "publicKey",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "commitmentPoint",
        "type": "tuple",
        "internalType": "struct Nydus.CommitmentPoint",
        "components": [
          {
            "name": "x",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "y",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "aggregatedM",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "aggregatedR",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "count",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "deposit",
    "inputs": [
      {
        "name": "_proof",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_publicInputs",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getBalanceReference",
    "inputs": [
      {
        "name": "nonceCommitment",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "encryptedBalance",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "encryptedTokenAddress",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getConfigId",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getEncryptedNullifier",
    "inputs": [
      {
        "name": "nonceCommitment",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "encryptedNullifier",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getNonceDiscoveryInfo",
    "inputs": [],
    "outputs": [
      {
        "name": "x",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "y",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "m",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "r",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getNonceDiscoveryOpeningValues",
    "inputs": [],
    "outputs": [
      {
        "name": "m",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "r",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPersonalCTotAndNullifier",
    "inputs": [
      {
        "name": "nonceCommitment",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "encCTotM",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "encCTotR",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "encryptedNullifier",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPersonalCTotReference",
    "inputs": [
      {
        "name": "nonceCommitment",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "encCTotM",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "encCTotR",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getStateCommitment",
    "inputs": [],
    "outputs": [
      {
        "name": "x",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "y",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getStateCommitmentOpeningValues",
    "inputs": [],
    "outputs": [
      {
        "name": "m",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "r",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "d",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getUserBalanceCommitmentStack",
    "inputs": [
      {
        "name": "pubKey",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "x",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "y",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "aggregatedM",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "aggregatedR",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "count",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getUserEncryptedNotes",
    "inputs": [
      {
        "name": "pubKey",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "notes",
        "type": "tuple[]",
        "internalType": "struct Nydus.EncryptedNote[]",
        "components": [
          {
            "name": "encryptedAmountForReceiver",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "encryptedTokenAddressForReceiver",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "senderPublicKey",
            "type": "tuple",
            "internalType": "struct Nydus.PublicKey",
            "components": [
              {
                "name": "x",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "y",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getUserEncryptedNotesCount",
    "inputs": [
      {
        "name": "pubKey",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "count",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getUserNoteCommitmentStack",
    "inputs": [
      {
        "name": "pubKey",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "x",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "y",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "aggregatedM",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "aggregatedR",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "count",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getVerifier",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "historicalBalanceCommitments",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "historicalNoteCommitments",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "historicalStateCommitments",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "initCommit",
    "inputs": [
      {
        "name": "_proof",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_publicInputs",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "isHistoricalStateCommitment",
    "inputs": [
      {
        "name": "x",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "y",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "exists",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "knownNonceCommitments",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lastOutput",
    "inputs": [],
    "outputs": [
      {
        "name": "attestationId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "userIdentifier",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "nullifier",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "issuingState",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "idNumber",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "nationality",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "dateOfBirth",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "gender",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "expiryDate",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "olderThan",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lastUserAddress",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lastUserData",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nonceCommitmentToBalance",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "encryptedBalance",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "encryptedTokenAddress",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nonceCommitmentToEncryptedNullifier",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nonceCommitmentToPersonalCTot",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "encCTotM",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "encCTotR",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nonceDiscoveryM",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nonceDiscoveryPoint",
    "inputs": [],
    "outputs": [
      {
        "name": "x",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "y",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nonceDiscoveryR",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "noteCommitmentStack",
    "inputs": [
      {
        "name": "publicKey",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "commitmentPoint",
        "type": "tuple",
        "internalType": "struct Nydus.CommitmentPoint",
        "components": [
          {
            "name": "x",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "y",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "aggregatedM",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "aggregatedR",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "count",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ofacEnabled",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "onVerificationSuccess",
    "inputs": [
      {
        "name": "output",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "userData",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "poseidon2Wrapper",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract Poseidon2YulWrapper"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "scope",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "send",
    "inputs": [
      {
        "name": "_proof",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_publicInputs",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "stateCommitmentD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "stateCommitmentM",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "stateCommitmentPoint",
    "inputs": [],
    "outputs": [
      {
        "name": "x",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "y",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "stateCommitmentR",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "usedUserAddressToProofNonOfac",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "userEncryptedNotes",
    "inputs": [
      {
        "name": "publicKey",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "encryptedAmountForReceiver",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "encryptedTokenAddressForReceiver",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "senderPublicKey",
        "type": "tuple",
        "internalType": "struct Nydus.PublicKey",
        "components": [
          {
            "name": "x",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "y",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "verificationConfig",
    "inputs": [],
    "outputs": [
      {
        "name": "olderThanEnabled",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "olderThan",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "forbiddenCountriesEnabled",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "verificationConfigId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "verificationSuccessful",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "verifiedUsers",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "verifiersByIndex",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "verifyGrumpkinCommitment",
    "inputs": [
      {
        "name": "x",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "y",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "isValid",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "verifySelfProof",
    "inputs": [
      {
        "name": "proofPayload",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "userContextData",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdraw",
    "inputs": [
      {
        "name": "_proof",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_publicInputs",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      },
      {
        "name": "arbitraryCalldata",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "Absorbed",
    "inputs": [
      {
        "name": "nonceCommitment",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "encryptedAbsorbedAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "encryptedTokenAddress",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "encryptedNewBalance",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "encryptedNewNullifier",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "encryptedPersonalCTotM",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "encryptedPersonalCTotR",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "encryptedReference",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Deposited",
    "inputs": [
      {
        "name": "nonceCommitment",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "encryptedBalance",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "encryptedTokenAddress",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "tokenAddress",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Initialized",
    "inputs": [
      {
        "name": "nonceCommitment",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "tokenAddress",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Sent",
    "inputs": [
      {
        "name": "nonceCommitment",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "encryptedBalance",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "encryptedTokenAddress",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "receiptNoteX",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "receiptNoteY",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "UserVerified",
    "inputs": [
      {
        "name": "userIdentifierHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "userAddress",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "VerificationCompleted",
    "inputs": [
      {
        "name": "output",
        "type": "tuple",
        "indexed": false,
        "internalType": "struct ISelfVerificationRoot.GenericDiscloseOutputV2",
        "components": [
          {
            "name": "attestationId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "userIdentifier",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nullifier",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "forbiddenCountriesListPacked",
            "type": "uint256[4]",
            "internalType": "uint256[4]"
          },
          {
            "name": "issuingState",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "name",
            "type": "string[]",
            "internalType": "string[]"
          },
          {
            "name": "idNumber",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "nationality",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "dateOfBirth",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "gender",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "expiryDate",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "olderThan",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "ofac",
            "type": "bool[3]",
            "internalType": "bool[3]"
          }
        ]
      },
      {
        "name": "userData",
        "type": "bytes",
        "indexed": false,
        "internalType": "bytes"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Withdrawn",
    "inputs": [
      {
        "name": "nonceCommitment",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "encryptedBalance",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "encryptedTokenAddress",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "tokenAddress",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "ArbitraryCalldataHashMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidDataFormat",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidProof",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NonceAlreadyExists",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoteAlreadyExists",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OfacBannedBitch",
    "inputs": [
      {
        "name": "userAddress",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "StateCommitmentAlreadyExists",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnauthorizedCaller",
    "inputs": []
  }
] as const;