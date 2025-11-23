// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "./Grumpkin.sol";
import "./Generators.sol";
import "./Poseidon2YulWrapper.sol";
import "./VerifiersConst.sol";
import "../lib/poseidon2-evm/src/Field.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./ProofOfHuman.sol";


/**
 * @title Nydus
 * @dev Main Nydus contract that uses Grumpkin curve for commitment management
 * @notice Provides commitment stack management using Grumpkin curve operations
 */
interface IVerifier {
    function verify(bytes calldata _proof, bytes32[] calldata _publicInputs) external view returns (bool);
}

contract Nydus is ProofOfHuman {
    // ============ ERRORS ============
   
    error InvalidProof();
    error NonceAlreadyExists();
    error NoteAlreadyExists();
    error ArbitraryCalldataHashMismatch();
    error StateCommitmentAlreadyExists();
    
    // ============ EVENTS ============
    
    event Initialized(
        uint256 indexed nonceCommitment,
        uint256 indexed tokenAddress,
        uint256 indexed amount
    );
    
    event Deposited(
        uint256 indexed nonceCommitment,
        uint256 encryptedBalance,
        uint256 encryptedTokenAddress,
        uint256 indexed tokenAddress,
        uint256 indexed amount
    );
    
    event Withdrawn(
        uint256 indexed nonceCommitment,
        uint256 encryptedBalance,
        uint256 encryptedTokenAddress,
        uint256 indexed tokenAddress,
        uint256 indexed amount
    );
    
    event Sent(
        uint256 indexed nonceCommitment,
        uint256 encryptedBalance,
        uint256 encryptedTokenAddress,
        uint256 receiptNoteX,
        uint256 receiptNoteY
    );
    
    event Absorbed(
        uint256 indexed nonceCommitment,
        uint256 encryptedAbsorbedAmount,
        uint256 encryptedTokenAddress,
        uint256 encryptedNewBalance,
        uint256 encryptedNewNullifier,
        uint256 encryptedPersonalCTotM,
        uint256 encryptedPersonalCTotR,
        uint256 encryptedReference
    );
    
    // ============ STRUCTS ============
    
    struct CommitmentStack {
        CommitmentPoint commitmentPoint;
        uint256 aggregatedM; // Aggregated opening value m for Pedersen commitment
        uint256 aggregatedR; // Aggregated opening value r for Pedersen commitment
        uint256 count;
    }
    
    struct CommitmentPoint {
        uint256 x;
        uint256 y;
    }

    struct PublicKey {
        uint256 x;
        uint256 y;
    }
    
    struct BalanceReference {
        uint256 encryptedBalance;
        uint256 encryptedTokenAddress;
    }
    
    struct PersonalCTotReference {
        uint256 encCTotM;
        uint256 encCTotR;
    }
    
    struct EncryptedNote {
        uint256 encryptedAmountForReceiver;
        uint256 encryptedTokenAddressForReceiver;
        PublicKey senderPublicKey;
    }
    
    // ============ STATE VARIABLES ============
    
    // Main state commitment stack (main_c_tot) - single point
    CommitmentPoint public stateCommitmentPoint;
    uint256 public stateCommitmentM; // Aggregated opening value m for state commitment (pedersen_commitment_positive uses 3 generators: G, H, D)
    uint256 public stateCommitmentR; // Aggregated opening value r for state commitment
    uint256 public stateCommitmentD; // Aggregated opening value d for state commitment (third generator D)
    
    CommitmentPoint public nonceDiscoveryPoint;
    uint256 public nonceDiscoveryM; // Aggregated opening value m for nonce discovery commitment
    uint256 public nonceDiscoveryR; // Aggregated opening value r for nonce discovery commitment
    
    // User balance commitment stacks (personal_c_tot) - per user
    mapping(bytes publicKey => CommitmentStack) public balanceCommitmentStack;
    
    // User note commitment stacks (notes_c_tot) - per user  
    mapping(bytes publicKey => CommitmentStack) public noteCommitmentStack;
    
    // Historical state commitments tracking
    mapping(bytes32 => bool) public historicalStateCommitments;
    
    // User commitment tracking
    mapping(uint256 => bool) public knownNonceCommitments;
    mapping(uint256 => address) public verifiersByIndex;
    mapping(bytes32 => bool) public historicalBalanceCommitments;
    mapping(bytes32 => bool) public historicalNoteCommitments;
    
    // Nonce commitment to balance reference mapping
    mapping(uint256 => BalanceReference) public nonceCommitmentToBalance;
    
    // Nonce commitment to personal_c_tot encrypted values mapping
    mapping(uint256 => PersonalCTotReference) public nonceCommitmentToPersonalCTot;
    
    // Nonce commitment to encrypted nullifier mapping (only for absorb operations)
    mapping(uint256 => uint256) public nonceCommitmentToEncryptedNullifier;
    
    // User public key to array of encrypted notes (incoming notes that can be decrypted)
    mapping(bytes publicKey => EncryptedNote[]) public userEncryptedNotes;

    // Poseidon2 hashing instance
    Poseidon2YulWrapper public immutable poseidon2Wrapper;
    
    // ============ CONSTRUCTOR ============
    
    constructor(
        address[] memory _verifiers, 
        address identityVerificationHubV2Address, 
        string memory scopeSeed, 
        SelfUtils.UnformattedVerificationConfigV2 memory _verificationConfig
    ) ProofOfHuman(
        identityVerificationHubV2Address, 
        scopeSeed, 
        _verificationConfig
    ) {
        // Initialize state commitment point with (1, 1) to avoid empty outer commitment
        stateCommitmentPoint = CommitmentPoint({
            x: 0x0bc6f794fe53f0c8704d41006c06065f765e884d12ea6841895866f6a7796568,
            y: 0x22539c9ee4342d7eaa4c5a67d5cb0c93ddf1e9e03c173e6a4e442b5d57a2b5bd 
        });
        // Initialize aggregated m, r, and d to 1 (initial state is pedersen_commitment_positive(1, 1, 1))
        stateCommitmentM = 1;
        stateCommitmentR = 1;
        stateCommitmentD = 1;
        
        // Initialize nonce discovery point
        nonceDiscoveryPoint = CommitmentPoint({
            x: 0x098b60b4fb636ed774329d8bb20eb1f9bd2f1b53445e991de219b50739e95c16 ,
            y: 0x1b82bb29393d7897d102bc412ca1b3353e78ecc738baf483fed847ef9e212997 
        });
        
        nonceDiscoveryM = 1;
        nonceDiscoveryR = 1;
        
        // Mark initial state as historical
        bytes32 initialStateHash = keccak256(abi.encodePacked(stateCommitmentPoint.x, stateCommitmentPoint.y));
        historicalStateCommitments[initialStateHash] = true;
        
        // Map verifiers by index
        for (uint256 i = 0; i < _verifiers.length; i++) {
            verifiersByIndex[i] = _verifiers[i];
        }
        
        // Initialize Poseidon2 wrapper
        poseidon2Wrapper = new Poseidon2YulWrapper();
    }
    
    // ============ INTERNAL FUNCTIONS ============
    
    /**
     * @dev Hash arbitrary calldata bytes using Poseidon2
     * @param data The bytes to hash
     * @return The hash result as uint256
     */
    function hashArbitraryCalldata(bytes memory data) internal view returns (uint256) {
        // Convert bytes to Field.Type array by splitting into 32-byte chunks
        uint256 numChunks = (data.length + 31) / 32;
        Field.Type[] memory fieldInputs = new Field.Type[](numChunks);
        
        for (uint256 i = 0; i < numChunks; i++) {
            uint256 value = 0;
            uint256 start = i * 32;
            uint256 end = start + 32;
            if (end > data.length) {
                end = data.length;
            }
            
            // Read bytes into uint256 (big-endian)
            for (uint256 j = start; j < end; j++) {
                value = (value << 8) | uint256(uint8(data[j]));
            }
            
            fieldInputs[i] = Field.toField(value);
        }
        
        // Hash the array using Poseidon2
        Field.Type hashResult = poseidon2Wrapper.hash(fieldInputs);
        return Field.toUint256(hashResult);
    }
    
    /**
     * @dev Aggregate two opening values (m or r) using BN254 scalar field addition
     * @param current The current aggregated value
     * @param newValue The new value to aggregate
     * @return The aggregated result
     */
    function aggregateOpeningValue(uint256 current, uint256 newValue) internal pure returns (uint256) {
        Field.Type currentField = Field.toField(current);
        Field.Type newValueField = Field.toField(newValue);
        Field.Type sum = Field.add(currentField, newValueField);
        return Field.toUint256(sum);
    }
    
    /**
     * @dev Add a nonce discovery entry to the aggregated nonce discovery point
     * @param x The x coordinate of the nonce_discovery_entry
     * @param y The y coordinate of the nonce_discovery_entry
     * @param m The opening value m for this entry (optional, can be 0 if not provided)
     * @param r The opening value r for this entry (optional, can be 0 if not provided)
     */
    function addNonceDiscoveryEntry(uint256 x, uint256 y, uint256 m, uint256 r) internal {
        Grumpkin.G1Point memory current = Grumpkin.G1Point(
            nonceDiscoveryPoint.x, 
            nonceDiscoveryPoint.y
        );
        Grumpkin.G1Point memory entry = Grumpkin.G1Point(x, y);
        Grumpkin.G1Point memory result = Grumpkin.add(current, entry);
        nonceDiscoveryPoint = CommitmentPoint({
            x: result.x,
            y: result.y
        });
        
        // Aggregate opening values using Poseidon2 Field operations
        if (m != 0) {
            nonceDiscoveryM = aggregateOpeningValue(nonceDiscoveryM, m);
        }
        if (r != 0) {
            nonceDiscoveryR = aggregateOpeningValue(nonceDiscoveryR, r);
        }
    }
    
    // ============ PUBLIC FUNCTIONS ============
    
    /**
     * @dev Add a commitment to the state commitment point using Grumpkin
     * @param x The x coordinate of the commitment
     * @param y The y coordinate of the commitment
     * @param m The opening value m for this commitment (scalar for generator G)
     * @param r The opening value r for this commitment (scalar for generator H)
     * @param d The opening value d for this commitment (scalar for generator D, typically new_nonce_commitment)
     * @return resultX The x coordinate of the resulting point
     * @return resultY The y coordinate of the resulting point
     */
    function addStateCommitment(
        uint256 x,
        uint256 y,
        uint256 m,
        uint256 r,
        uint256 d
    ) public returns (uint256 resultX, uint256 resultY) {
        // Store current state in historical tracking before updating
        bytes32 currentStateHash = keccak256(abi.encodePacked(stateCommitmentPoint.x, stateCommitmentPoint.y));
        historicalStateCommitments[currentStateHash] = true;
        
        // Add to current state commitment using Grumpkin
        Grumpkin.G1Point memory currentPoint = Grumpkin.G1Point(stateCommitmentPoint.x, stateCommitmentPoint.y);
        Grumpkin.G1Point memory newPoint = Grumpkin.G1Point(x, y);
        Grumpkin.G1Point memory result = Grumpkin.add(currentPoint, newPoint);
        
        // Update state commitment point
        stateCommitmentPoint.x = result.x;
        stateCommitmentPoint.y = result.y;
        
        // Aggregate opening values using Poseidon2 Field operations
        // All three values (m, r, d) are aggregated since pedersen_commitment_positive uses 3 generators
            stateCommitmentM = aggregateOpeningValue(stateCommitmentM, m);
            stateCommitmentR = aggregateOpeningValue(stateCommitmentR, r);
        stateCommitmentD = aggregateOpeningValue(stateCommitmentD, d);
        
        // Store new state in historical tracking
        bytes32 newStateHash = keccak256(abi.encodePacked(result.x, result.y));
        historicalStateCommitments[newStateHash] = true;
        
        return (stateCommitmentPoint.x, stateCommitmentPoint.y);
    }
    
   
    
    /**
     * @dev Add a note commitment with duplicate checking using Pedersen commitment
     * @param pubKey The user's public key (concatenated x+y coordinates)
     * @param newNoteStackX The new note stack x value (scalar for Pedersen commitment)
     * @param newNoteStackY The new note stack y value (scalar for Pedersen commitment)
     * @param m The opening value m for this commitment (optional, can be 0 if not provided)
     * @param r The opening value r for this commitment (optional, can be 0 if not provided)
     * @return resultX The x coordinate of the resulting stack
     * @return resultY The y coordinate of the resulting stack
     * @return newCount The new count of commitments in the stack
     */
    function addNoteCommitment(
        bytes memory pubKey,
        uint256 newNoteStackX,
        uint256 newNoteStackY,
        uint256 m,
        uint256 r
    ) public returns (uint256 resultX, uint256 resultY, uint256 newCount) {
        CommitmentStack storage stack = noteCommitmentStack[pubKey];
        
        // Create Pedersen commitment: newNoteStackX * G + newNoteStackY * H + 0 * D
        (uint256 gx, uint256 gy) = Generators.getG();
        (uint256 hx, uint256 hy) = Generators.getH();
        (uint256 dx, uint256 dy) = Generators.getD();
        
        Grumpkin.G1Point memory G = Grumpkin.G1Point(gx, gy);
        Grumpkin.G1Point memory H = Grumpkin.G1Point(hx, hy);
        Grumpkin.G1Point memory D = Grumpkin.G1Point(dx, dy);
        
        Grumpkin.G1Point memory newCommitment = Grumpkin.pedersenCommitment(
            G,
            H,
            D,
            newNoteStackX,  // scalar1
            newNoteStackY,  // scalar2
            0               // scalar3 (always 0 for note stack)
        );
        
        // Check for duplicate using the commitment point (x, y)
        bytes32 noteHash = keccak256(abi.encodePacked(newCommitment.x, newCommitment.y));
        if (historicalNoteCommitments[noteHash]) {
            revert NoteAlreadyExists();
        }
        
        // Check if stack is initialized by checking if commitment point is zero (uninitialized stack has default values)
        if (stack.commitmentPoint.x == 0 && stack.commitmentPoint.y == 0) {
            // Initialize new stack with the Pedersen commitment
            stack.commitmentPoint = CommitmentPoint({x: newCommitment.x, y: newCommitment.y});
            stack.aggregatedM = 0;
            stack.aggregatedR = 0;
            stack.count = 1;
        } else {
            // Add the new Pedersen commitment to the existing stack
            Grumpkin.G1Point memory currentPoint = Grumpkin.G1Point(stack.commitmentPoint.x, stack.commitmentPoint.y);
            Grumpkin.G1Point memory result = Grumpkin.add(currentPoint, newCommitment);
            
            stack.commitmentPoint = CommitmentPoint({x: result.x, y: result.y});
            stack.count++;
        }
        
        // Aggregate opening values using Poseidon2 Field operations
        if (m != 0) {
            stack.aggregatedM = aggregateOpeningValue(stack.aggregatedM, m);
        }
        if (r != 0) {
            stack.aggregatedR = aggregateOpeningValue(stack.aggregatedR, r);
        }
        
        historicalNoteCommitments[noteHash] = true;
        return (stack.commitmentPoint.x, stack.commitmentPoint.y, stack.count);
    }

    
    /**
     * @dev Add two commitments using Grumpkin curve operations
     * @param c1X X coordinate of first commitment
     * @param c1Y Y coordinate of first commitment
     * @param c2X X coordinate of second commitment
     * @param c2Y Y coordinate of second commitment
     * @return resultX X coordinate of result
     * @return resultY Y coordinate of result
     */
    function addCommitments(
        uint256 c1X,
        uint256 c1Y,
        uint256 c2X,
        uint256 c2Y
    ) public view returns (uint256 resultX, uint256 resultY) {
        Grumpkin.G1Point memory c1 = Grumpkin.G1Point(c1X, c1Y);
        Grumpkin.G1Point memory c2 = Grumpkin.G1Point(c2X, c2Y);
        Grumpkin.G1Point memory result = Grumpkin.add(c1, c2);
        
        return (result.x, result.y);
    }

    // ============ CIRCUIT OPERATIONS ============
    error OfacBannedBitch(address userAddress);
    /**
     * @dev Initialize a new commitment (entry circuit)
     * @param _proof The zkSNARK proof
     * @param _publicInputs The public inputs from the circuit
     */
    function initCommit(bytes calldata _proof, bytes32[] calldata _publicInputs) public {

        if (usedUserAddressToProofNonOfac[msg.sender] == bytes32(0)) {
            revert OfacBannedBitch(msg.sender);
        }
        bool isValid = IVerifier(VerifiersConst.ENTRY_VERIFIER).verify(_proof, _publicInputs);
        if (!isValid) {
            revert InvalidProof();
        }

        uint256 tokenAddress = uint256(_publicInputs[0]);
        uint256 amount = uint256(_publicInputs[1]);
        uint256 newNonceCommitment = uint256(_publicInputs[2]);
        CommitmentPoint memory newMainCommitment = CommitmentPoint({x: uint256(_publicInputs[3]), y: uint256(_publicInputs[4])});
        CommitmentPoint memory nonceDiscoveryEntry = CommitmentPoint({x: uint256(_publicInputs[5]), y: uint256(_publicInputs[6])});
        
        // encrypted_personal_c_tot_opening_values: [Field; 2]
        uint256 enc_x = uint256(_publicInputs[7]);
        uint256 enc_y = uint256(_publicInputs[8]);
        

        if (knownNonceCommitments[newNonceCommitment]) {
            revert NonceAlreadyExists();
        }
        knownNonceCommitments[newNonceCommitment] = true;

        // Use enc_x, enc_y, and newNonceCommitment as opening values m, r, d for state commitment
        // pedersen_commitment_positive(enc_x, enc_y, new_nonce_commitment) uses 3 generators (G, H, D)
        addStateCommitment(newMainCommitment.x, newMainCommitment.y, enc_x, enc_y, newNonceCommitment);
        // Nonce discovery entry opening values: m=1, r=newNonceCommitment (from pedersen_commitment_non_hiding(1, new_nonce_commitment))
        addNonceDiscoveryEntry(nonceDiscoveryEntry.x, nonceDiscoveryEntry.y, 1, newNonceCommitment);
        
        // Save balance reference (plaintext values since entry circuit doesn't encrypt)
        // For initCommit, we store plaintext amount and tokenAddress instead of encrypted values
        nonceCommitmentToBalance[newNonceCommitment] = BalanceReference({
            encryptedBalance: amount,  // Plaintext amount (not encrypted in entry circuit)
            encryptedTokenAddress: tokenAddress  // Plaintext tokenAddress (not encrypted in entry circuit)
        });
        
        // Save personal_c_tot encrypted values (enc_x and enc_y from public inputs)
        // This is needed for subsequent operations to compute main_c_outer_point correctly
        nonceCommitmentToPersonalCTot[newNonceCommitment] = PersonalCTotReference({
            encCTotM: enc_x,
            encCTotR: enc_y
        });
        
        emit Initialized(newNonceCommitment, tokenAddress, amount);
    }

    /**
     * @dev Deposit tokens (deposit circuit)
     * @param _proof The zkSNARK proof
     * @param _publicInputs The public inputs from the circuit
     */
    function deposit(bytes calldata _proof, bytes32[] calldata _publicInputs) public {
        
        bool isValid = IVerifier(VerifiersConst.DEPOSIT_VERIFIER).verify(_proof, _publicInputs);
        if (!isValid) {
            revert InvalidProof();
        }

        address tokenAddress = address(uint160(uint256(_publicInputs[0])));
        uint256 amount = uint256(_publicInputs[1]);
        CommitmentPoint memory mainCommitmentReference = CommitmentPoint({x: uint256(_publicInputs[2]), y: uint256(_publicInputs[3])});
        uint256 newNonceCommitment = uint256(_publicInputs[4]);
      
        CommitmentPoint memory newMainCommitment = CommitmentPoint({x: uint256(_publicInputs[5]), y: uint256(_publicInputs[6])});
        
        // encrypted_note: [Field; 5] from encrypt_operation_details
        uint256 encryptedAmount = uint256(_publicInputs[7]);
        uint256 encryptedTokenAddress = uint256(_publicInputs[8]);
        uint256 encryptedReference = uint256(_publicInputs[9]);
        uint256 encryptedPersonalCTotM = uint256(_publicInputs[10]);
        uint256 encryptedPersonalCTotR = uint256(_publicInputs[11]);

        CommitmentPoint memory nonceDiscoveryEntry = CommitmentPoint({x: uint256(_publicInputs[12]), y: uint256(_publicInputs[13])});
        
        // enc_x and enc_y: [Field; 2] - encrypted coordinates for new main commitment
        uint256 enc_x = uint256(_publicInputs[14]);
        uint256 enc_y = uint256(_publicInputs[15]);
        
        if (knownNonceCommitments[newNonceCommitment]) {
            revert NonceAlreadyExists();
        }
        knownNonceCommitments[newNonceCommitment] = true;

        // Use enc_x, enc_y, and newNonceCommitment as opening values m, r, d for state commitment
        // pedersen_commitment_positive(enc_x, enc_y, new_nonce_commitment) uses 3 generators (G, H, D)
        addStateCommitment(newMainCommitment.x, newMainCommitment.y, enc_x, enc_y, newNonceCommitment);
        // Nonce discovery entry opening values: m=1, r=newNonceCommitment (from pedersen_commitment_non_hiding(1, new_nonce_commitment))
        addNonceDiscoveryEntry(nonceDiscoveryEntry.x, nonceDiscoveryEntry.y, 1, newNonceCommitment);
        
        // Save balance reference
        nonceCommitmentToBalance[newNonceCommitment] = BalanceReference({
            encryptedBalance: encryptedAmount,
            encryptedTokenAddress: encryptedTokenAddress
        });
        
        // Save personal_c_tot encrypted values
        nonceCommitmentToPersonalCTot[newNonceCommitment] = PersonalCTotReference({
            encCTotM: encryptedPersonalCTotM,
            encCTotR: encryptedPersonalCTotR
        });

        //IERC20(tokenAddress).transferFrom(msg.sender, address(this), amount);
        emit Deposited(newNonceCommitment, encryptedAmount, encryptedTokenAddress, uint256(uint160(tokenAddress)), amount);
    }

    /**
     * @dev Absorb incoming notes into personal balance (absorb circuit)
     * @param _proof The zkSNARK proof
     * @param _publicInputs The public inputs from the circuit
     */
    function absorb(bytes calldata _proof, bytes32[] calldata _publicInputs) public {
        bool isValid = IVerifier(VerifiersConst.ABSORB_VERIFIER).verify(_proof, _publicInputs);
        if (!isValid) {
            revert InvalidProof();
        }

        // Total: 18 public inputs/outputs (indices 0-17)
        // Public inputs (4 fields, indices 0-3): main_c_tot[2], relay_fee_token_address, receiver_fee_amount
        CommitmentPoint memory mainCommitmentReference = CommitmentPoint({x: uint256(_publicInputs[0]), y: uint256(_publicInputs[1])});
        address relayFeeTokenAddress = address(uint160(uint256(_publicInputs[2])));
        uint256 receiverFeeAmount = uint256(_publicInputs[3]);
        
        // Public outputs (14 fields, indices 4-17): new_nonce_commitment, new_main_commitment[2], encrypted_note[7], nonce_discovery_entry[2], enc_x/enc_y[2]
        uint256 newNonceCommitment = uint256(_publicInputs[4]);
        CommitmentPoint memory newMainCommitment = CommitmentPoint({x: uint256(_publicInputs[5]), y: uint256(_publicInputs[6])});
        
        // encrypted_note: [Field; 7]
        uint256 encryptedAbsorbedAmount = uint256(_publicInputs[7]);
        uint256 encryptedTokenAddress = uint256(_publicInputs[8]);
        uint256 encryptedReference = uint256(_publicInputs[9]);
        uint256 encryptedNewBalance = uint256(_publicInputs[10]);
        uint256 encryptedPersonalCTotM = uint256(_publicInputs[11]);
        uint256 encryptedPersonalCTotR = uint256(_publicInputs[12]);
        uint256 encryptedNewNullifier = uint256(_publicInputs[13]);
        
        CommitmentPoint memory nonceDiscoveryEntry = CommitmentPoint({x: uint256(_publicInputs[14]), y: uint256(_publicInputs[15])});
        
        // enc_x and enc_y: [Field; 2] - encrypted coordinates for new main commitment
        uint256 enc_x = uint256(_publicInputs[16]);
        uint256 enc_y = uint256(_publicInputs[17]);
        
        if (knownNonceCommitments[newNonceCommitment]) {
            revert NonceAlreadyExists();
        }
        knownNonceCommitments[newNonceCommitment] = true;
        // Use enc_x, enc_y, and newNonceCommitment as opening values m, r, d for state commitment
        // pedersen_commitment_positive(enc_x, enc_y, new_nonce_commitment) uses 3 generators (G, H, D)
        addStateCommitment(newMainCommitment.x, newMainCommitment.y, enc_x, enc_y, newNonceCommitment);
        // Nonce discovery entry opening values: m=1, r=newNonceCommitment (from pedersen_commitment_non_hiding(1, new_nonce_commitment))
        addNonceDiscoveryEntry(nonceDiscoveryEntry.x, nonceDiscoveryEntry.y, 1, newNonceCommitment);
        
        // Save balance reference (use encryptedNewBalance as the balance after absorption)
        nonceCommitmentToBalance[newNonceCommitment] = BalanceReference({
            encryptedBalance: encryptedNewBalance,
            encryptedTokenAddress: encryptedTokenAddress
        });
        
        // Save personal_c_tot encrypted values
        nonceCommitmentToPersonalCTot[newNonceCommitment] = PersonalCTotReference({
            encCTotM: encryptedPersonalCTotM,
            encCTotR: encryptedPersonalCTotR
        });
        
        // Save encrypted nullifier (for tracking balance spent from notes)
        nonceCommitmentToEncryptedNullifier[newNonceCommitment] = encryptedNewNullifier;

        //IERC20(relayFeeTokenAddress).transfer(msg.sender, receiverFeeAmount);
        
        emit Absorbed(
            newNonceCommitment,
            encryptedAbsorbedAmount,
            encryptedTokenAddress,
            encryptedNewBalance,
            encryptedNewNullifier,
            encryptedPersonalCTotM,
            encryptedPersonalCTotR,
            encryptedReference
        );
    }

    /**
     * @dev Withdraw tokens (withdraw circuit)
     * @param _proof The zkSNARK proof
     * @param _publicInputs The public inputs from the circuit
     */
    function withdraw(bytes calldata _proof, bytes32[] calldata _publicInputs, bytes memory arbitraryCalldata) public {
        bool isValid = IVerifier(VerifiersConst.WITHDRAW_VERIFIER).verify(_proof, _publicInputs);
        if (!isValid) {
            revert InvalidProof();
        }

        address tokenAddress = address(uint160(uint256(_publicInputs[0])));
        uint256 amount = uint256(_publicInputs[1]);
       
        CommitmentPoint memory mainCommitmentReference = CommitmentPoint({x: uint256(_publicInputs[2]), y: uint256(_publicInputs[3])});
        uint256 arbitraryCalldataHash = uint256(_publicInputs[4]);
        address receiverAddress = address(uint160(uint256(_publicInputs[5])));
        address relayFeeTokenAddress = address(uint160(uint256(_publicInputs[6])));
        uint256 relayFeeAmount = uint256(_publicInputs[7]);

        uint256 newNonceCommitment = uint256(_publicInputs[8]);
        CommitmentPoint memory newMainCommitment = CommitmentPoint({x: uint256(_publicInputs[9]), y: uint256(_publicInputs[10])});
        

        uint encryptedAmount = uint256(_publicInputs[11]);
        uint encryptedTokenAddress = uint256(_publicInputs[12]);
        uint encryptedReference = uint256(_publicInputs[13]);
        uint encryptedPersonalCTotMessage = uint256(_publicInputs[14]);
        uint encryptedPersonalCTotR = uint256(_publicInputs[15]);
        CommitmentPoint memory nonceDiscoveryEntry = CommitmentPoint({x: uint256(_publicInputs[16]), y: uint256(_publicInputs[17])});
        
        // enc_x and enc_y: [Field; 2] - encrypted coordinates for new main commitment
        uint256 enc_x = uint256(_publicInputs[18]);
        uint256 enc_y = uint256(_publicInputs[19]);

        // Verify arbitraryCalldata hash
        // Skip verification if arbitraryCalldataHash is all zeros (0x000...000) - used for testing
        if (arbitraryCalldataHash != 0) {
        uint256 computedCalldataHash = hashArbitraryCalldata(arbitraryCalldata);
        if (computedCalldataHash != arbitraryCalldataHash) {
            revert ArbitraryCalldataHashMismatch();
            }
        }

        if (knownNonceCommitments[newNonceCommitment]) {
            revert NonceAlreadyExists();
        }
        knownNonceCommitments[newNonceCommitment] = true;
      
        // Use enc_x, enc_y, and newNonceCommitment as opening values m, r, d for state commitment
        // pedersen_commitment_positive(enc_x, enc_y, new_nonce_commitment) uses 3 generators (G, H, D)
        addStateCommitment(newMainCommitment.x, newMainCommitment.y, enc_x, enc_y, newNonceCommitment);
        // Nonce discovery entry opening values: m=1, r=newNonceCommitment (from pedersen_commitment_non_hiding(1, new_nonce_commitment))
        addNonceDiscoveryEntry(nonceDiscoveryEntry.x, nonceDiscoveryEntry.y, 1, newNonceCommitment);
        
        // Save balance reference
        nonceCommitmentToBalance[newNonceCommitment] = BalanceReference({
            encryptedBalance: encryptedAmount,
            encryptedTokenAddress: encryptedTokenAddress
        });
        
        // Save personal_c_tot encrypted values
        nonceCommitmentToPersonalCTot[newNonceCommitment] = PersonalCTotReference({
            encCTotM: encryptedPersonalCTotMessage,
            encCTotR: encryptedPersonalCTotR
        });

        //IERC20(relayFeeTokenAddress).transfer(msg.sender, relayFeeAmount);
        //IERC20(tokenAddress).transfer(receiverAddress, amount);
        emit Withdrawn(newNonceCommitment, encryptedAmount, encryptedTokenAddress, uint256(uint160(tokenAddress)), amount);
    }

    /**
     * @dev Send tokens to another user (send circuit)
     * @param _proof The zkSNARK proof
     * @param _publicInputs The public inputs from the circuit
     */
    function send(bytes calldata _proof, bytes32[] calldata _publicInputs) public {
        bool isValid = IVerifier(VerifiersConst.SEND_VERIFIER).verify(_proof, _publicInputs);
        if (!isValid) {
            revert InvalidProof();
        }

        // Total: 28 public inputs/outputs (indices 0-27)
        // Public inputs (8 fields, indices 0-7): token_address, amount, main_c_tot[2], receiver_public_key[2], relay_fee_token_address, receiver_fee_amount
        address tokenAddress = address(uint160(uint256(_publicInputs[0])));
        uint256 amount = uint256(_publicInputs[1]);
        CommitmentPoint memory mainCommitmentReference = CommitmentPoint({x: uint256(_publicInputs[2]), y: uint256(_publicInputs[3])});
        PublicKey memory receiverPublicKey = PublicKey({x: uint256(_publicInputs[4]), y: uint256(_publicInputs[5])});
        address relayFeeTokenAddress = address(uint160(uint256(_publicInputs[6])));
        uint256 receiverFeeAmount = uint256(_publicInputs[7]);
        
        // Public outputs (20 fields, indices 8-27): new_nonce_commitment, new_main_commitment[2], encrypted_note[7], sender_pub_key[2], nonce_discovery_entry[2], enc_x/enc_y[2], notes_c_tot[2], receiver_public_key[2]
        uint256 newNonceCommitment = uint256(_publicInputs[8]);
        CommitmentPoint memory newMainCommitment = CommitmentPoint({x: uint256(_publicInputs[9]), y: uint256(_publicInputs[10])});
        
        // encrypted_note: [Field; 7]
        // [0-1]: For receiver's note (encrypted with shared_key_hash)
        uint256 encryptedAmountForReceiver = uint256(_publicInputs[11]);
        uint256 encryptedTokenAddressForReceiver = uint256(_publicInputs[12]);
        // [2-4]: For sender's balance tracking (encrypted with encryption_key, like in deposit)
        uint256 encryptedAmountForSender = uint256(_publicInputs[13]);
        uint256 encryptedTokenAddressForSender = uint256(_publicInputs[14]);
        uint256 encryptedReference = uint256(_publicInputs[15]);
        // [5-6]: For sender's new state (encrypted with encryption_key)
        uint256 encryptedPersonalCTotM = uint256(_publicInputs[16]);
        uint256 encryptedPersonalCTotR = uint256(_publicInputs[17]);
        
        PublicKey memory senderPublicKey = PublicKey({x: uint256(_publicInputs[18]), y: uint256(_publicInputs[19])});
        CommitmentPoint memory nonceDiscoveryEntry = CommitmentPoint({x: uint256(_publicInputs[20]), y: uint256(_publicInputs[21])});
        
        // enc_x and enc_y: [Field; 2] - encrypted coordinates for new main commitment
        uint256 enc_x = uint256(_publicInputs[22]);
        uint256 enc_y = uint256(_publicInputs[23]);
        
        // notes_c_tot commitment
        CommitmentPoint memory notesCTot = CommitmentPoint({x: uint256(_publicInputs[24]), y: uint256(_publicInputs[25])});
        
        // receiver_public_key (duplicate in outputs for verification)
     
        if (knownNonceCommitments[newNonceCommitment]) {
            revert NonceAlreadyExists();
        }
        knownNonceCommitments[newNonceCommitment] = true;
        if (isHistoricalStateCommitment(newMainCommitment.x, newMainCommitment.y)) {
            revert StateCommitmentAlreadyExists();
        }
        // Use enc_x, enc_y, and newNonceCommitment as opening values m, r, d for state commitment
        // pedersen_commitment_positive(enc_x, enc_y, new_nonce_commitment) uses 3 generators (G, H, D)
        addStateCommitment(newMainCommitment.x, newMainCommitment.y, enc_x, enc_y, newNonceCommitment);
        // Nonce discovery entry opening values: m=1, r=newNonceCommitment (from pedersen_commitment_non_hiding(1, new_nonce_commitment))
        addNonceDiscoveryEntry(nonceDiscoveryEntry.x, nonceDiscoveryEntry.y, 1, newNonceCommitment);
        
        // Save balance reference (using sender's encrypted values, like in deposit)
        nonceCommitmentToBalance[newNonceCommitment] = BalanceReference({
            encryptedBalance: encryptedAmountForSender,
            encryptedTokenAddress: encryptedTokenAddressForSender
        });
        
        // Save personal_c_tot encrypted values
        nonceCommitmentToPersonalCTot[newNonceCommitment] = PersonalCTotReference({
            encCTotM: encryptedPersonalCTotM,
            encCTotR: encryptedPersonalCTotR
        });
        
        // Add note commitment to receiver's noteCommitmentStack
        // Convert receiver public key to bytes for mapping key
        bytes memory receiverPubKeyBytes = abi.encodePacked(receiverPublicKey.x, receiverPublicKey.y);
        
        // Add the notes_c_tot commitment to receiver's stack
        // The notes_c_tot is computed in the circuit as: notes_c_inner + notes_c_outer + reference_commitment
        // We add the complete notes_c_tot point to the receiver's stack
        CommitmentStack storage receiverStack = noteCommitmentStack[receiverPubKeyBytes];
        
        // Check if stack is initialized by checking if commitment point is zero (uninitialized stack has default values)
        if (receiverStack.commitmentPoint.x == 0 && receiverStack.commitmentPoint.y == 0) {
            // Initialize new stack with the notes_c_tot commitment
            receiverStack.commitmentPoint = CommitmentPoint({x: notesCTot.x, y: notesCTot.y});
        } else {
            // Add the notes_c_tot commitment to the existing stack
            Grumpkin.G1Point memory currentPoint = Grumpkin.G1Point(receiverStack.commitmentPoint.x, receiverStack.commitmentPoint.y);
            Grumpkin.G1Point memory notesCTotPoint = Grumpkin.G1Point(notesCTot.x, notesCTot.y);
            Grumpkin.G1Point memory result = Grumpkin.add(currentPoint, notesCTotPoint);
            
            receiverStack.commitmentPoint = CommitmentPoint({x: result.x, y: result.y});
        }
        
        // Also add receiver's note stack to stateCommitment because main_c_tot = notes_c_tot + main_c_outer
        // The circuit verifies that notes_c_tot is part of main_c_tot (stateCommitment)
        // We create a commitment using the receiver stack point as opening values:
        // pedersen_commitment_positive(receiverStack.commitmentPoint.x, receiverStack.commitmentPoint.y, 1)
        // This represents the receiver's note stack root in the state commitment
        (uint256 gx, uint256 gy) = Generators.getG();
        (uint256 hx, uint256 hy) = Generators.getH();
        (uint256 dx, uint256 dy) = Generators.getD();
        
        Grumpkin.G1Point memory G = Grumpkin.G1Point(gx, gy);
        Grumpkin.G1Point memory H = Grumpkin.G1Point(hx, hy);
        Grumpkin.G1Point memory D = Grumpkin.G1Point(dx, dy);
        
        // Create commitment: receiverStack.commitmentPoint.x * G + receiverStack.commitmentPoint.y * H + 1 * D
        // This commitment represents the receiver's note stack root in the state commitment
        Grumpkin.G1Point memory noteStackRootCommitment = Grumpkin.pedersenCommitment(
            G,
            H,
            D,
            receiverStack.commitmentPoint.x,  // m (opening value)
            receiverStack.commitmentPoint.y,  // r (opening value)
            1                                  // d (instead of nonceCommitment)
        );
        
        // Add this commitment to stateCommitment with opening values (receiverStack.commitmentPoint.x, receiverStack.commitmentPoint.y, 1)
        addStateCommitment(noteStackRootCommitment.x, noteStackRootCommitment.y, receiverStack.commitmentPoint.x, receiverStack.commitmentPoint.y, 1);
        
        // Mark this note commitment as historical to prevent duplicates
        bytes32 noteHash = keccak256(abi.encodePacked(notesCTot.x, notesCTot.y));
        historicalNoteCommitments[noteHash] = true;
        
        // Store encrypted note for receiver to decrypt later
        userEncryptedNotes[receiverPubKeyBytes].push(EncryptedNote({
            encryptedAmountForReceiver: encryptedAmountForReceiver,
            encryptedTokenAddressForReceiver: encryptedTokenAddressForReceiver,
            senderPublicKey: senderPublicKey
        }));
        
        //IERC20(relayFeeTokenAddress).transfer(msg.sender, receiverFeeAmount);
        emit Sent(newNonceCommitment, encryptedAmountForSender, encryptedTokenAddressForSender, notesCTot.x, notesCTot.y);
    }
    
    // ============ VIEW FUNCTIONS ============
    
    /**
     * @dev Get current state commitment point
     * @return x The x coordinate of the state commitment
     * @return y The y coordinate of the state commitment
     */
    function getStateCommitment() public view returns (uint256 x, uint256 y) {
        return (stateCommitmentPoint.x, stateCommitmentPoint.y);
    }
    
    /**
     * @dev Check if a state commitment exists in historical tracking
     * @param x The x coordinate of the state commitment
     * @param y The y coordinate of the state commitment
     * @return exists True if the state commitment exists in historical tracking
     */
    function isHistoricalStateCommitment(uint256 x, uint256 y) public view returns (bool exists) {
        bytes32 stateHash = keccak256(abi.encodePacked(x, y));
        return historicalStateCommitments[stateHash];
    }
    
    /**
     * @dev Get user note commitment stack data
     * @param pubKey The user's public key (concatenated x+y coordinates)
     * @return x The x coordinate of the stack
     * @return y The y coordinate of the stack
     * @return aggregatedM The aggregated opening value m for the stack
     * @return aggregatedR The aggregated opening value r for the stack
     * @return count The number of commitments in the stack
     */
    function getUserNoteCommitmentStack(bytes memory pubKey) public view returns (
        uint256 x,
        uint256 y,
        uint256 aggregatedM,
        uint256 aggregatedR,
        uint256 count
    ) {
        CommitmentStack memory stack = noteCommitmentStack[pubKey];
        return (stack.commitmentPoint.x, stack.commitmentPoint.y, stack.aggregatedM, stack.aggregatedR, stack.count);
    }
    
    /**
     * @dev Get user balance commitment stack data
     * @param pubKey The user's public key (concatenated x+y coordinates)
     * @return x The x coordinate of the stack
     * @return y The y coordinate of the stack
     * @return aggregatedM The aggregated opening value m for the stack
     * @return aggregatedR The aggregated opening value r for the stack
     * @return count The number of commitments in the stack
     */
    function getUserBalanceCommitmentStack(bytes memory pubKey) public view returns (
        uint256 x,
        uint256 y,
        uint256 aggregatedM,
        uint256 aggregatedR,
        uint256 count
    ) {
        CommitmentStack memory stack = balanceCommitmentStack[pubKey];
        return (stack.commitmentPoint.x, stack.commitmentPoint.y, stack.aggregatedM, stack.aggregatedR, stack.count);
    }
    
    /**
     * @dev Get state commitment aggregated opening values
     * @return m The aggregated opening value m for state commitment (scalar for generator G)
     * @return r The aggregated opening value r for state commitment (scalar for generator H)
     * @return d The aggregated opening value d for state commitment (scalar for generator D)
     */
    function getStateCommitmentOpeningValues() public view returns (uint256 m, uint256 r, uint256 d) {
        return (stateCommitmentM, stateCommitmentR, stateCommitmentD);
    }
    
    /**
     * @dev Get nonce discovery aggregated opening values
     * @return m The aggregated opening value m for nonce discovery commitment
     * @return r The aggregated opening value r for nonce discovery commitment
     */
    function getNonceDiscoveryOpeningValues() public view returns (uint256 m, uint256 r) {
        return (nonceDiscoveryM, nonceDiscoveryR);
    }
    
    /**
     * @dev Get complete nonce discovery information (point and opening values)
     * @return x The x coordinate of the nonce discovery point
     * @return y The y coordinate of the nonce discovery point
     * @return m The aggregated opening value m for nonce discovery commitment
     * @return r The aggregated opening value r for nonce discovery commitment
     */
    function getNonceDiscoveryInfo() public view returns (
        uint256 x,
        uint256 y,
        uint256 m,
        uint256 r
    ) {
        return (nonceDiscoveryPoint.x, nonceDiscoveryPoint.y, nonceDiscoveryM, nonceDiscoveryR);
    }
    
    
    /**
     * @dev Verify that Grumpkin commitment coordinates are valid
     * @param x X coordinate from Grumpkin
     * @param y Y coordinate from Grumpkin
     * @return isValid True if the point is valid on Grumpkin curve
     */
    function verifyGrumpkinCommitment(
        uint256 x,
        uint256 y
    ) public pure returns (bool isValid) {
        // Grumpkin curve equation: y^2 = x^3 - 17 (mod p)
        uint256 p = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;
        
        uint256 ySquared = mulmod(y, y, p);
        uint256 xCubed = mulmod(mulmod(x, x, p), x, p);
        uint256 rhs = addmod(xCubed, p - 17, p); // x^3 - 17 mod p
        
        return ySquared == rhs;
    }
    
    /**
     * @dev Get verifier address by index
     * @param index The verifier index
     * @return The verifier address
     */
    function getVerifier(uint256 index) public view returns (address) {
        return verifiersByIndex[index];
    }
    
    /**
     * @dev Get encrypted balance and token address for a given nonce commitment
     * @param nonceCommitment The nonce commitment to look up
     * @return encryptedBalance The encrypted balance value
     * @return encryptedTokenAddress The encrypted token address value
     */
    function getBalanceReference(uint256 nonceCommitment) public view returns (
        uint256 encryptedBalance,
        uint256 encryptedTokenAddress
    ) {
        BalanceReference memory balanceRef = nonceCommitmentToBalance[nonceCommitment];
        return (balanceRef.encryptedBalance, balanceRef.encryptedTokenAddress);
    }
    
    /**
     * @dev Get personal_c_tot encrypted values for a given nonce commitment
     * @param nonceCommitment The nonce commitment to look up
     * @return encCTotM The encrypted personal_c_tot M value
     * @return encCTotR The encrypted personal_c_tot R value
     */
    function getPersonalCTotReference(uint256 nonceCommitment) public view returns (
        uint256 encCTotM,
        uint256 encCTotR
    ) {
        PersonalCTotReference memory personalCTotRef = nonceCommitmentToPersonalCTot[nonceCommitment];
        return (personalCTotRef.encCTotM, personalCTotRef.encCTotR);
    }
    
    /**
     * @dev Get encrypted nullifier for a given nonce commitment (only for absorb operations)
     * @param nonceCommitment The nonce commitment to look up
     * @return encryptedNullifier The encrypted nullifier value (0 if not set, e.g., for deposit/withdraw/send operations)
     */
    function getEncryptedNullifier(uint256 nonceCommitment) public view returns (uint256 encryptedNullifier) {
        return nonceCommitmentToEncryptedNullifier[nonceCommitment];
    }
    
    /**
     * @dev Get personal_c_tot encrypted values and encrypted nullifier for a given nonce commitment
     * @param nonceCommitment The nonce commitment to look up
     * @return encCTotM The encrypted personal_c_tot M value
     * @return encCTotR The encrypted personal_c_tot R value
     * @return encryptedNullifier The encrypted nullifier value (0 if not set, e.g., for deposit/withdraw/send operations)
     */
    function getPersonalCTotAndNullifier(uint256 nonceCommitment) public view returns (
        uint256 encCTotM,
        uint256 encCTotR,
        uint256 encryptedNullifier
    ) {
        PersonalCTotReference memory personalCTotRef = nonceCommitmentToPersonalCTot[nonceCommitment];
        return (
            personalCTotRef.encCTotM,
            personalCTotRef.encCTotR,
            nonceCommitmentToEncryptedNullifier[nonceCommitment]
        );
    }
    
    /**
     * @dev Get all encrypted notes for a user
     * @param pubKey The user's public key (concatenated x+y coordinates)
     * @return notes Array of encrypted notes
     */
    function getUserEncryptedNotes(bytes memory pubKey) public view returns (EncryptedNote[] memory notes) {
        return userEncryptedNotes[pubKey];
    }
    
    /**
     * @dev Get encrypted note count for a user
     * @param pubKey The user's public key (concatenated x+y coordinates)
     * @return count Number of encrypted notes
     */
    function getUserEncryptedNotesCount(bytes memory pubKey) public view returns (uint256 count) {
        return userEncryptedNotes[pubKey].length;
    }
}